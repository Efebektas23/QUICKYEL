"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  CheckCircle,
  Clock,
  ChevronDown,
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
  Calendar,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { expensesApi, cardsApi } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";
import { ReviewModal } from "@/components/expenses/ReviewModal";
import toast from "react-hot-toast";

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
    card_last_4?: string;
  }>({});
  const [selectedExpense, setSelectedExpense] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(false);
  const pageSize = 20;

  // Fetch all expenses for proper client-side filtering
  const { data: allData, isLoading, refetch } = useQuery({
    queryKey: ["expenses", "all"],
    queryFn: () => expensesApi.list({ per_page: 1000 }),
    refetchOnMount: "always", // Always refetch when navigating to this page
  });

  // Fetch cards for card-based filtering
  const { data: cards } = useQuery({
    queryKey: ["cards"],
    queryFn: () => cardsApi.list(),
  });

  // Apply all filters client-side
  const filteredData = useMemo(() => {
    if (!allData?.expenses) return { expenses: [] as any[], total: 0 };
    let expenses = [...allData.expenses];

    // Category filter
    if (filter.category) {
      expenses = expenses.filter((e: any) => e.category === filter.category);
    }

    // Status filter
    if (filter.verified_only !== undefined) {
      expenses = expenses.filter((e: any) => e.is_verified === filter.verified_only);
    }

    // Quarter filter
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

    // Card filter
    if (filter.card_last_4) {
      expenses = expenses.filter((e: any) => e.card_last_4 === filter.card_last_4);
    }

    // Sort by transaction date descending
    expenses.sort((a: any, b: any) => {
      const da = a.transaction_date ? new Date(a.transaction_date).getTime() : 0;
      const db = b.transaction_date ? new Date(b.transaction_date).getTime() : 0;
      return db - da;
    });

    return { expenses, total: expenses.length };
  }, [allData, filter]);

  // Client-side pagination
  const totalPages = Math.ceil(filteredData.total / pageSize);
  const paginatedExpenses = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredData.expenses.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  // Reset page when filters change
  const updateFilter = (newFilter: typeof filter) => {
    setFilter(newFilter);
    setPage(1);
  };

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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">
            Expenses
          </h1>
          <p className="text-slate-400 mt-1">
            {filteredData.total} total expenses
          </p>
        </div>

        {/* Filters Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary"
        >
          <Filter className="w-4 h-4" />
          Filters
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform",
              showFilters && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="card p-4"
          >
            <div className="flex flex-wrap gap-4">
              {/* Period / Quarter Filter */}
              <div>
                <label className="text-sm text-slate-400 mb-1 block">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />
                  Period
                </label>
                <select
                  value={filter.quarter || ""}
                  onChange={(e) =>
                    updateFilter({ ...filter, quarter: e.target.value || undefined })
                  }
                  className="input-field min-w-[220px]"
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
              </div>

              {/* Category Filter */}
              <div>
                <label className="text-sm text-slate-400 mb-1 block">
                  Category
                </label>
                <select
                  value={filter.category || ""}
                  onChange={(e) =>
                    updateFilter({ ...filter, category: e.target.value || undefined })
                  }
                  className="input-field min-w-[180px]"
                >
                  <option value="">All Categories</option>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Credit Card Filter */}
              <div>
                <label className="text-sm text-slate-400 mb-1 block">
                  <CreditCard className="w-3.5 h-3.5 inline mr-1" />
                  Credit Card
                </label>
                <select
                  value={filter.card_last_4 || ""}
                  onChange={(e) =>
                    updateFilter({ ...filter, card_last_4: e.target.value || undefined })
                  }
                  className="input-field min-w-[220px]"
                >
                  <option value="">All Cards</option>
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
                                {card.card_name} (•••• {card.last_four}) {card.is_company_card ? "- Company" : "- Personal"}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {usdCards.length > 0 && (
                          <optgroup label="USD Cards">
                            {usdCards.map((card: any) => (
                              <option key={card.id} value={card.last_four}>
                                {card.card_name} (•••• {card.last_four}) {card.is_company_card ? "- Company" : "- Personal"}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {otherCards.length > 0 && (
                          <optgroup label="Cards (No Currency Set)">
                            {otherCards.map((card: any) => (
                              <option key={card.id} value={card.last_four}>
                                {card.card_name} (•••• {card.last_four}) {card.is_company_card ? "- Company" : "- Personal"}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    );
                  })()}
                </select>
              </div>

              {/* Verification Filter */}
              <div>
                <label className="text-sm text-slate-400 mb-1 block">
                  Status
                </label>
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
                  className="input-field min-w-[140px]"
                >
                  <option value="">All</option>
                  <option value="verified">Verified</option>
                  <option value="pending">Pending Review</option>
                </select>
              </div>

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={() => updateFilter({})}
                  className="btn-ghost text-sm"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">
                      Date
                    </th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">
                      Vendor
                    </th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">
                      Category
                    </th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400 text-right">
                      Amount (CAD)
                    </th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">
                      Status
                    </th>
                    <th className="px-6 py-4 text-sm font-medium text-slate-400">
                      Actions
                    </th>
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

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-800">
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
            <h3 className="text-lg font-medium text-white mb-2">
              No expenses found
            </h3>
            <p className="text-slate-400 mb-4">
              {Object.keys(filter).length > 0
                ? "Try adjusting your filters"
                : "Upload your first receipt to get started"}
            </p>
            <Link href="/upload" className="btn-primary">
              Upload Receipt
            </Link>
          </div>
        )}

        {/* Pagination */}
        {filteredData.total > pageSize && (
          <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
            <p className="text-sm text-slate-400">
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
          <span className="text-sm text-white font-medium">
            {expense.vendor_name || "Unknown Vendor"}
          </span>
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

  return (
    <div className="p-4 hover:bg-slate-800/30 transition-colors">
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
            <div>
              <p className="text-sm font-medium text-white truncate">
                {expense.vendor_name || "Unknown Vendor"}
              </p>
              <p className="text-xs text-slate-500">
                {formatDate(expense.transaction_date)}
              </p>
            </div>
            <p className="text-sm font-semibold text-white">
              {formatCurrency(expense.cad_amount)}
            </p>
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
                onClick={onEdit}
                className="p-1.5 text-slate-400 hover:text-yel-500"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 text-slate-400 hover:text-red-500"
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

