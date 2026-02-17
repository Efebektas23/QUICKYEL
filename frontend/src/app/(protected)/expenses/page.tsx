"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  Clock,
  Fuel,
  Wrench,
  UtensilsCrossed,
  Bed,
  Scale,
  FileText,
  FileCheck,
  HelpCircle,
  ExternalLink,
  Trash2,
  Landmark,
  Camera,
  Link2,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { expensesApi, cardsApi } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";
import { ReviewModal } from "@/components/expenses/ReviewModal";
import toast from "react-hot-toast";

// ============ Intelligent Search Helpers ============

/**
 * Fuzzy vendor matching: case-insensitive, partial match, handles minor variations.
 * "Greenway" matches "Greenway Complex Services"
 * "green complex" matches "Greenway Complex Services"
 */
function fuzzyMatch(query: string, text: string): boolean {
  if (!query || !text) return false;
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase().trim();

  // Direct substring match
  if (t.includes(q)) return true;

  // Multi-word: all query words must appear somewhere in the text
  const queryWords = q.split(/\s+/).filter(w => w.length > 0);
  if (queryWords.length > 1) {
    return queryWords.every(qw =>
      t.includes(qw) ||
      // Also check if any text word starts with the query word
      t.split(/[\s,.\-\/]+/).some(tw => tw.startsWith(qw))
    );
  }

  // Single word: check if any word in text starts with the query
  const textWords = t.split(/[\s,.\-\/]+/);
  return textWords.some(tw => tw.startsWith(q));
}

/**
 * Parse amount search queries like "$1,250", "1250", "1200-1300", ">500", "<100"
 */
function parseAmountQuery(query: string): { type: "exact" | "range" | "gt" | "lt"; value?: number; min?: number; max?: number } | null {
  const cleaned = query.replace(/[\$,\s]/g, "");

  // Range: "1200-1300"
  const rangeMatch = cleaned.match(/^(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)$/);
  if (rangeMatch) {
    return { type: "range", min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }

  // Greater than: ">500"
  const gtMatch = cleaned.match(/^>(\d+\.?\d*)$/);
  if (gtMatch) {
    return { type: "gt", value: parseFloat(gtMatch[1]) };
  }

  // Less than: "<100"
  const ltMatch = cleaned.match(/^<(\d+\.?\d*)$/);
  if (ltMatch) {
    return { type: "lt", value: parseFloat(ltMatch[1]) };
  }

  // Exact amount: "1250" or "1250.00"
  const exactMatch = cleaned.match(/^(\d+\.?\d*)$/);
  if (exactMatch && parseFloat(exactMatch[1]) > 0) {
    return { type: "exact", value: parseFloat(exactMatch[1]) };
  }

  return null;
}

function matchesAmountQuery(amount: number, amountQuery: ReturnType<typeof parseAmountQuery>): boolean {
  if (!amountQuery) return false;
  switch (amountQuery.type) {
    case "exact":
      // Match within $1 tolerance for convenience
      return Math.abs(amount - (amountQuery.value || 0)) < 1;
    case "range":
      return amount >= (amountQuery.min || 0) && amount <= (amountQuery.max || Infinity);
    case "gt":
      return amount > (amountQuery.value || 0);
    case "lt":
      return amount < (amountQuery.value || 0);
    default:
      return false;
  }
}

const categoryIcons: Record<string, React.ReactNode> = {
  fuel: <Fuel className="w-4 h-4" />,
  maintenance_repairs: <Wrench className="w-4 h-4" />,
  meals_entertainment: <UtensilsCrossed className="w-4 h-4" />,
  travel_lodging: <Bed className="w-4 h-4" />,
  tolls_scales: <Scale className="w-4 h-4" />,
  office_admin: <FileText className="w-4 h-4" />,
  licenses_dues: <FileCheck className="w-4 h-4" />,
  uncategorized: <HelpCircle className="w-4 h-4" />,
};

// Period filter options (Fiscal Years + Quarters)
const PERIOD_OPTIONS = [
  // Fiscal Years
  { id: "fy_2025", label: "Fiscal Year 2025", group: "year", start: "2025-01-01", end: "2025-12-31" },
  { id: "fy_2026", label: "Fiscal Year 2026", group: "year", start: "2026-01-01", end: "2026-12-31" },
  // 2025 Quarters
  { id: "q1_2025", label: "Q1 2025 (Jan–Mar)", group: "2025", start: "2025-01-01", end: "2025-03-31" },
  { id: "q2_2025", label: "Q2 2025 (Apr–Jun)", group: "2025", start: "2025-04-01", end: "2025-06-30" },
  { id: "q3_2025", label: "Q3 2025 (Jul–Sep)", group: "2025", start: "2025-07-01", end: "2025-09-30" },
  { id: "q4_2025", label: "Q4 2025 (Oct–Dec)", group: "2025", start: "2025-10-01", end: "2025-12-31" },
  // 2026 Quarters
  { id: "q1_2026", label: "Q1 2026 (Jan–Mar)", group: "2026", start: "2026-01-01", end: "2026-03-31" },
  { id: "q2_2026", label: "Q2 2026 (Apr–Jun)", group: "2026", start: "2026-04-01", end: "2026-06-30" },
  { id: "q3_2026", label: "Q3 2026 (Jul–Sep)", group: "2026", start: "2026-07-01", end: "2026-09-30" },
  { id: "q4_2026", label: "Q4 2026 (Oct–Dec)", group: "2026", start: "2026-10-01", end: "2026-12-31" },
];

export default function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<{
    category?: string;
    verified_only?: boolean;
    quarter?: string;
    account?: string;
    source?: string;
  }>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedExpense, setSelectedExpense] = useState<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 20;
  const isSearchActive = searchQuery.trim().length > 0;

  // Debounce search input (300ms) to avoid expensive filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch all expenses for proper client-side filtering
  const { data: allData, isLoading, refetch } = useQuery({
    queryKey: ["expenses", "all"],
    queryFn: () => expensesApi.list({ per_page: 1000 }),
    refetchOnMount: "always",
  });

  // Fetch cards for card-based filtering
  const { data: cards } = useQuery({
    queryKey: ["cards"],
    queryFn: () => cardsApi.list(),
  });

  // Apply all filters + smart search client-side
  const filteredData = useMemo(() => {
    if (!allData?.expenses) return { expenses: [] as any[], total: 0 };
    let expenses = [...allData.expenses];

    if (filter.category) {
      expenses = expenses.filter((e: any) => e.category === filter.category);
    }

    if (filter.verified_only !== undefined) {
      expenses = expenses.filter((e: any) => e.is_verified === filter.verified_only);
    }

    if (filter.quarter) {
      const quarter = PERIOD_OPTIONS.find((q) => q.id === filter.quarter);
      if (quarter) {
        const startDate = new Date(quarter.start);
        const endDate = new Date(quarter.end);
        endDate.setHours(23, 59, 59, 999);
        expenses = expenses.filter((e: any) => {
          if (!e.transaction_date) return false;
          const txDate = new Date(e.transaction_date);
          return txDate >= startDate && txDate <= endDate;
        });
      }
    }

    if (filter.account) {
      if (filter.account === "checking") {
        expenses = expenses.filter((e: any) =>
          e.payment_source === "bank_checking" || e.entry_type === "bank_import"
        );
      } else {
        expenses = expenses.filter((e: any) => e.card_last_4 === filter.account);
      }
    }

    if (filter.source) {
      expenses = expenses.filter((e: any) => {
        const hasReceipt = !!e.receipt_image_url;
        const isBankImport = e.entry_type === "bank_import";
        const isMatched = (hasReceipt && e.bank_linked) || (isBankImport && e.receipt_linked);
        switch (filter.source) {
          case "matched": return isMatched;
          case "receipt_only": return hasReceipt && !e.bank_linked && !isBankImport;
          case "bank_only": return isBankImport && !e.receipt_linked && !hasReceipt;
          case "unmatched": return !isMatched;
          default: return true;
        }
      });
    }

    // ── Smart Search Filter (uses debounced value for performance) ──
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim();
      const amountQuery = parseAmountQuery(q);

      expenses = expenses.filter((e: any) => {
        // 1. Vendor name (fuzzy match)
        if (fuzzyMatch(q, e.vendor_name || "")) return true;

        // 2. Notes / memo
        if (fuzzyMatch(q, e.notes || "")) return true;

        // 3. Bank description
        if (fuzzyMatch(q, e.bank_description || "")) return true;

        // 4. Category label
        const catLabel = categoryLabels[e.category] || e.category || "";
        if (fuzzyMatch(q, catLabel)) return true;

        // 5. Amount match (e.g. "$1,250" or "1200-1300" or ">500")
        if (amountQuery && matchesAmountQuery(e.cad_amount || 0, amountQuery)) return true;

        // 6. Date match (e.g. "Feb 12" or "2026-02-12")
        if (e.transaction_date) {
          const formattedDate = formatDate(e.transaction_date);
          if (formattedDate.toLowerCase().includes(q.toLowerCase())) return true;
          // Also check raw date string
          const rawDate = typeof e.transaction_date === "string" ? e.transaction_date : "";
          if (rawDate.includes(q)) return true;
        }

        // 7. Card last 4
        if (e.card_last_4 && e.card_last_4.includes(q)) return true;

        // 8. OCR raw text (deep search)
        if (e.raw_ocr_text && e.raw_ocr_text.toLowerCase().includes(q.toLowerCase())) return true;

        return false;
      });
    }

    expenses.sort((a: any, b: any) => {
      const dateA = a.transaction_date ? new Date(a.transaction_date) : new Date(0);
      const dateB = b.transaction_date ? new Date(b.transaction_date) : new Date(0);
      const diff = dateB.getTime() - dateA.getTime();
      if (diff !== 0) return diff;
      const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return createdB - createdA;
    });

    return { expenses, total: expenses.length };
  }, [allData, filter, debouncedSearch]);

  // Client-side pagination (bypassed when search is active)
  const totalPages = isSearchActive ? 1 : Math.ceil(filteredData.total / pageSize);
  const paginatedExpenses = useMemo(() => {
    if (isSearchActive) return filteredData.expenses; // Show ALL results when searching
    const start = (page - 1) * pageSize;
    return filteredData.expenses.slice(start, start + pageSize);
  }, [filteredData, page, pageSize, isSearchActive]);

  const updateFilter = (newFilter: typeof filter) => {
    setFilter(newFilter);
    setPage(1);
  };

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this expense?")) return;

    try {
      await expensesApi.delete(id);
      toast.success("Expense deleted");
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to delete");
    }
  };

  // Compute summary stats from filtered data
  const summaryStats = useMemo(() => {
    const expenses = filteredData.expenses;
    const total = expenses.reduce((sum: number, e: any) => sum + (e.cad_amount || 0), 0);
    const gst = expenses.reduce((sum: number, e: any) => sum + (e.gst_amount || 0), 0);
    const hst = expenses.reduce((sum: number, e: any) => sum + (e.hst_amount || 0), 0);
    const pst = expenses.reduce((sum: number, e: any) => sum + (e.pst_amount || 0), 0);
    const verified = expenses.filter((e: any) => e.is_verified).length;
    const pending = expenses.filter((e: any) => !e.is_verified).length;
    const matched = expenses.filter((e: any) => {
      const hasReceipt = !!e.receipt_image_url;
      const isBankImport = e.entry_type === "bank_import";
      return (hasReceipt && e.bank_linked) || (isBankImport && e.receipt_linked);
    }).length;
    const needsReceipt = expenses.filter((e: any) =>
      e.entry_type === "bank_import" && !e.receipt_linked && !e.receipt_image_url
    ).length;
    return { total, gst, hst, pst, taxTotal: gst + hst + pst, verified, pending, count: expenses.length, matched, needsReceipt };
  }, [filteredData]);

  const hasActiveFilters = filter.category || filter.verified_only !== undefined || filter.quarter || filter.account || filter.source || isSearchActive;

  const chipClass = (isActive: boolean) => cn(
    "text-sm rounded-full px-3 py-1.5 border transition-colors appearance-none cursor-pointer pr-7 bg-no-repeat bg-[right_8px_center] bg-[length:12px]",
    "bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%2394a3b8%22%20stroke-width=%222%22%3E%3Cpath%20d=%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')]",
    isActive
      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
      : "border-slate-700 bg-slate-800/50 text-slate-400"
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-white">
            Expenses
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {filteredData.total} expense{filteredData.total !== 1 ? "s" : ""}
            {hasActiveFilters && " (filtered)"}
            {isSearchActive && " — showing all results"}
          </p>
        </div>
      </div>

      {/* ── Global Smart Search Bar ── */}
      <div className="relative group" id="expense-smart-search">
        <div className={cn(
          "relative flex items-center rounded-xl border transition-all duration-200",
          isSearchActive
            ? "border-amber-500/50 bg-amber-500/5 shadow-lg shadow-amber-500/10"
            : "border-slate-700 bg-slate-800/50 hover:border-slate-600 focus-within:border-amber-500/50 focus-within:bg-amber-500/5 focus-within:shadow-lg focus-within:shadow-amber-500/10"
        )}>
          <Search className={cn(
            "w-5 h-5 ml-4 flex-shrink-0 transition-colors",
            isSearchActive ? "text-amber-500" : "text-slate-500 group-focus-within:text-amber-500"
          )} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by vendor, amount ($1,250), date, memo, category..."
            className="flex-1 bg-transparent text-white placeholder-slate-500 px-3 py-3 md:py-3.5 text-sm md:text-base outline-none"
            id="expense-search-input"
          />
          {isSearchActive && (
            <div className="flex items-center gap-2 mr-3">
              <span className="text-xs text-amber-400/80 font-medium whitespace-nowrap">
                {filteredData.total} result{filteredData.total !== 1 ? "s" : ""}
              </span>
              <button
                onClick={clearSearch}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        {/* Search hint */}
        {!isSearchActive && (
          <p className="text-xs text-slate-600 mt-1.5 ml-1 hidden md:block">
            💡 Try: vendor name, <span className="text-slate-500">&quot;$1,250&quot;</span>, <span className="text-slate-500">&quot;1000-2000&quot;</span>, <span className="text-slate-500">&quot;{'>'}500&quot;</span>, date, or memo keywords
          </p>
        )}
        {/* No results message */}
        {isSearchActive && filteredData.total === 0 && (
          <div className="mt-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-sm text-slate-400">
              No matching records found for <span className="text-white font-medium">"{searchQuery}"</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Try a different vendor name, amount, or date. Search supports partial matches.
            </p>
          </div>
        )}
      </div>

      {/* Summary Bar — always visible */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-3 md:p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total</p>
          <p className="text-lg md:text-xl font-bold text-white">{formatCurrency(summaryStats.total)}</p>
        </div>
        <div className="card p-3 md:p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Tax Claimed</p>
          <p className="text-lg md:text-xl font-bold text-emerald-400">{formatCurrency(summaryStats.taxTotal)}</p>
        </div>
        <div className="card p-3 md:p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Verified</p>
          <p className="text-lg md:text-xl font-bold text-white">
            {summaryStats.verified}
            <span className="text-sm font-normal text-slate-500 ml-1">/ {summaryStats.count}</span>
          </p>
        </div>
        <div className="card p-3 md:p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Pending</p>
          <p className="text-lg md:text-xl font-bold text-amber-400">{summaryStats.pending}</p>
        </div>
        <div className="card p-3 md:p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Matched</p>
          <p className="text-lg md:text-xl font-bold text-cyan-400">
            <Link2 className="w-4 h-4 inline mr-1 -mt-0.5" />
            {summaryStats.matched}
          </p>
          {summaryStats.needsReceipt > 0 && (
            <p className="text-xs text-amber-400/80 mt-0.5">{summaryStats.needsReceipt} need receipts</p>
          )}
        </div>
      </div>

      {/* Inline Filters — always visible, compact chips */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter.quarter || ""}
          onChange={(e) => updateFilter({ ...filter, quarter: e.target.value || undefined })}
          className={chipClass(!!filter.quarter)}
        >
          <option value="">All Periods</option>
          <optgroup label="Fiscal Year">
            {PERIOD_OPTIONS.filter((p) => p.group === "year").map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="2026 Quarters">
            {PERIOD_OPTIONS.filter((p) => p.group === "2026").map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="2025 Quarters">
            {PERIOD_OPTIONS.filter((p) => p.group === "2025").map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
        </select>

        <select
          value={filter.category || ""}
          onChange={(e) => updateFilter({ ...filter, category: e.target.value || undefined })}
          className={chipClass(!!filter.category)}
        >
          <option value="">All Categories</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          value={filter.account || ""}
          onChange={(e) => updateFilter({ ...filter, account: e.target.value || undefined })}
          className={chipClass(!!filter.account)}
        >
          <option value="">All Accounts</option>
          <optgroup label="Bank Accounts">
            <option value="checking">RBC Checking</option>
          </optgroup>
          {cards && cards.length > 0 && (() => {
            const cadCards = cards.filter((c: any) => c.currency === "CAD");
            const usdCards = cards.filter((c: any) => c.currency === "USD");
            const otherCards = cards.filter((c: any) => !c.currency);
            return (
              <>
                {cadCards.length > 0 && (
                  <optgroup label="CAD Cards">
                    {cadCards.map((card: any) => (
                      <option key={card.id} value={card.last_four}>
                        {card.card_name} (•••• {card.last_four})
                      </option>
                    ))}
                  </optgroup>
                )}
                {usdCards.length > 0 && (
                  <optgroup label="USD Cards">
                    {usdCards.map((card: any) => (
                      <option key={card.id} value={card.last_four}>
                        {card.card_name} (•••• {card.last_four})
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherCards.length > 0 && (
                  <optgroup label="Other Cards">
                    {otherCards.map((card: any) => (
                      <option key={card.id} value={card.last_four}>
                        {card.card_name} (•••• {card.last_four})
                      </option>
                    ))}
                  </optgroup>
                )}
              </>
            );
          })()}
        </select>

        <select
          value={
            filter.verified_only === undefined
              ? ""
              : filter.verified_only
                ? "verified"
                : "pending"
          }
          onChange={(e) => {
            if (e.target.value === "") {
              updateFilter({ ...filter, verified_only: undefined });
            } else {
              updateFilter({
                ...filter,
                verified_only: e.target.value === "verified",
              });
            }
          }}
          className={chipClass(filter.verified_only !== undefined)}
        >
          <option value="">All Status</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending Review</option>
        </select>

        <select
          value={filter.source || ""}
          onChange={(e) => updateFilter({ ...filter, source: e.target.value || undefined })}
          className={chipClass(!!filter.source)}
        >
          <option value="">All Sources</option>
          <option value="matched">🔗 Matched (Both)</option>
          <option value="receipt_only">📷 Receipt Only</option>
          <option value="bank_only">🏦 Bank Only</option>
          <option value="unmatched">Unmatched</option>
        </select>

        {hasActiveFilters && (
          <button
            onClick={() => {
              updateFilter({});
              setSearchQuery("");
            }}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Expenses List */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-yel-500 border-r-transparent" />
          </div>
        ) : paginatedExpenses.length > 0 ? (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-800/50 text-left">
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">Date</th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">Vendor</th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">Category</th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400 text-right">Amount (CAD)</th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">Status</th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {paginatedExpenses.map((expense: any) => (
                    <ExpenseRow
                      key={expense.id}
                      expense={expense}
                      onEdit={() => setSelectedExpense(expense)}
                      onDelete={() => handleDelete(expense.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards — improved with larger touch targets */}
            <div className="md:hidden divide-y divide-slate-800/50">
              {paginatedExpenses.map((expense: any) => (
                <ExpenseCard
                  key={expense.id}
                  expense={expense}
                  onEdit={() => setSelectedExpense(expense)}
                  onDelete={() => handleDelete(expense.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
              <FileText className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No expenses found</h3>
            <p className="text-slate-400 mb-4">
              {hasActiveFilters ? "Try adjusting your filters" : "Upload your first receipt to get started"}
            </p>
            <Link href="/upload" className="btn-primary">Upload Receipt</Link>
          </div>
        )}

        {/* Pagination (hidden when search is active — all results shown) */}
        {filteredData.total > pageSize && !isSearchActive && (
          <div className="px-4 md:px-6 py-3 md:py-4 border-t border-slate-800 flex items-center justify-between">
            <p className="text-xs md:text-sm text-slate-400">
              Page {page} of {totalPages} ({filteredData.total} results)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="btn-ghost text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
        {/* Search results count bar */}
        {isSearchActive && filteredData.total > 0 && (
          <div className="px-4 md:px-6 py-3 border-t border-slate-800 flex items-center justify-between">
            <p className="text-xs md:text-sm text-slate-400">
              Showing all {filteredData.total} matching result{filteredData.total !== 1 ? "s" : ""}
            </p>
            <button
              onClick={clearSearch}
              className="text-xs text-amber-400 hover:text-amber-300 font-medium"
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      {/* Review Modal */}
      {selectedExpense && (
        <ReviewModal
          isOpen={!!selectedExpense}
          onClose={() => setSelectedExpense(null)}
          expense={selectedExpense}
          onSave={() => {
            setSelectedExpense(null);
            refetch();
            toast.success("Expense updated");
          }}
        />
      )}
    </div>
  );
}

function ExpenseRow({
  expense,
  onEdit,
  onDelete,
}: {
  expense: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = categoryColors[expense.category] || "#6B7280";
  const sourceInfo = getSourceInfo(expense);

  return (
    <tr className="hover:bg-slate-800/30 transition-colors">
      <td className="px-6 py-4 text-sm text-white">
        {formatDate(expense.transaction_date)}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          {expense.receipt_image_url && (
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0">
              <img
                src={expense.receipt_image_url}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="min-w-0">
            <span className="text-sm text-white font-medium">
              {expense.vendor_name || "Unknown Vendor"}
            </span>
            <div className="mt-0.5">
              <SourceBadge info={sourceInfo} />
            </div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{
            backgroundColor: `${color}20`,
            color: color,
          }}
        >
          {categoryIcons[expense.category]}
          {categoryLabels[expense.category] || expense.category}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <p className="text-sm font-semibold text-white">
          {formatCurrency(expense.cad_amount)}
        </p>
        {expense.original_currency === "USD" && (
          <p className="text-xs text-slate-500">
            {formatCurrency(expense.original_amount, "USD")}
          </p>
        )}
      </td>
      <td className="px-6 py-4">
        {expense.is_verified ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-500 text-sm">
            <CheckCircle className="w-4 h-4" />
            Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-amber-500 text-sm">
            <Clock className="w-4 h-4" />
            Pending
          </span>
        )}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="p-2 text-slate-400 hover:text-yel-500 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ExpenseCard({
  expense,
  onEdit,
  onDelete,
}: {
  expense: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = categoryColors[expense.category] || "#6B7280";
  const sourceInfo = getSourceInfo(expense);

  return (
    <div
      className="p-4 hover:bg-slate-800/30 transition-colors active:bg-slate-800/50 cursor-pointer"
      onClick={onEdit}
    >
      <div className="flex items-start gap-3">
        {expense.receipt_image_url && (
          <div className="w-12 h-16 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0">
            <img
              src={expense.receipt_image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {expense.vendor_name || "Unknown Vendor"}
              </p>
              <p className="text-xs text-slate-500">
                {formatDate(expense.transaction_date)}
              </p>
              <div className="mt-0.5">
                <SourceBadge info={sourceInfo} />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-semibold text-white">
                {formatCurrency(expense.cad_amount)}
              </p>
              {expense.original_currency === "USD" && (
                <p className="text-xs text-slate-500">
                  {formatCurrency(expense.original_amount, "USD")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: `${color}20`,
                color: color,
              }}
            >
              {categoryIcons[expense.category]}
              {categoryLabels[expense.category]}
            </span>
            <div className="flex items-center gap-1">
              {expense.is_verified ? (
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              ) : (
                <Clock className="w-4 h-4 text-amber-500" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1.5 text-slate-400 hover:text-red-500 min-w-[32px] min-h-[32px] flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Source Matching Helpers ============

function getSourceInfo(expense: any): { type: "matched" | "receipt_only" | "bank_only" | "manual"; score?: number; reason?: string } {
  const hasReceipt = !!expense.receipt_image_url;
  const isBankImport = expense.entry_type === "bank_import";

  // Matched: receipt expense linked to bank, or bank expense linked to receipt
  if ((hasReceipt && expense.bank_linked) || (isBankImport && expense.receipt_linked)) {
    return {
      type: "matched",
      score: expense.bank_match_score,
      reason: expense.bank_match_reason,
    };
  }

  // Bank import only (no receipt attached)
  if (isBankImport && !hasReceipt) {
    return { type: "bank_only" };
  }

  // Receipt/OCR only (not linked to bank)
  if (hasReceipt && !expense.bank_linked) {
    return { type: "receipt_only" };
  }

  // Manual entry or other
  return { type: "manual" };
}

function SourceBadge({ info }: { info: ReturnType<typeof getSourceInfo> }) {
  switch (info.type) {
    case "matched":
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/20"
          title={info.reason ? `Match: ${info.reason} (score: ${info.score})` : "Matched"}
        >
          <Link2 className="w-3 h-3" />
          Matched
        </span>
      );
    case "bank_only":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400/80 border border-amber-500/20">
          <Landmark className="w-3 h-3" />
          Bank only
        </span>
      );
    case "receipt_only":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/15 text-slate-400 border border-slate-500/20">
          <Camera className="w-3 h-3" />
          Receipt
        </span>
      );
    default:
      return null;
  }
}
