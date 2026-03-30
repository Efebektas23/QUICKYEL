"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronLeft,
  ExternalLink,
  FileText,
  Landmark,
  ImageIcon,
  PenLine,
  Link2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Tag,
} from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  expensesApi,
  type CategoryAuditTransaction,
  type ExpenseSourceKind,
} from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";
import { EXPENSE_CATEGORIES } from "@/lib/categories";

function statusBadge(status: CategoryAuditTransaction["matching_status"]) {
  if (status === "matched")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Matched
      </span>
    );
  if (status === "potential_duplicate")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/15 text-amber-400">
        <AlertTriangle className="w-3 h-3" />
        Possible duplicate
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-500/15 text-slate-400">
      Unmatched
    </span>
  );
}

function sourceLabel(kind: ExpenseSourceKind) {
  if (kind === "bank") return "Bank";
  if (kind === "receipt") return "Receipt";
  return "Manual";
}

function sourceIcon(kind: ExpenseSourceKind) {
  if (kind === "bank") return <Landmark className="w-3.5 h-3.5" />;
  if (kind === "receipt") return <ImageIcon className="w-3.5 h-3.5" />;
  return <PenLine className="w-3.5 h-3.5" />;
}

function RowCategorySelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full max-w-[140px] rounded-md bg-slate-800 border border-slate-600 px-1.5 py-1 text-[11px] text-white"
    >
      {EXPENSE_CATEGORIES.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

interface CategoryExpenseDrawerProps {
  open: boolean;
  onClose: () => void;
  category: string | null;
  /** Dashboard period (null = all time) */
  periodStart: string | null;
  periodEnd: string | null;
  expectedTotalCad: number;
  expectedCount: number;
}

export function CategoryExpenseDrawer({
  open,
  onClose,
  category,
  periodStart,
  periodEnd,
  expectedTotalCad,
  expectedCount,
}: CategoryExpenseDrawerProps) {
  const queryClient = useQueryClient();
  const [filterStart, setFilterStart] = useState<string>("");
  const [filterEnd, setFilterEnd] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<ExpenseSourceKind | "all">("all");
  const [truckDriverQ, setTruckDriverQ] = useState("");
  const [selected, setSelected] = useState<CategoryAuditTransaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("fuel");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFilterStart(periodStart || "");
      setFilterEnd(periodEnd || "");
      setSourceFilter("all");
      setTruckDriverQ("");
      setSelected(null);
      setSelectedIds(new Set());
    }
  }, [open, periodStart, periodEnd, category]);

  const startQ = filterStart || undefined;
  const endQ = filterEnd || undefined;

  const filtersMatchDashboard =
    (filterStart || "") === (periodStart || "") &&
    (filterEnd || "") === (periodEnd || "") &&
    sourceFilter === "all" &&
    !truckDriverQ.trim();
  const expectedForApi = filtersMatchDashboard ? expectedTotalCad : undefined;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [
      "category-audit",
      category,
      startQ,
      endQ,
      sourceFilter,
      truckDriverQ,
      expectedForApi,
    ],
    queryFn: () =>
      expensesApi.listByCategoryAudit({
        category: category!,
        start_date: startQ || null,
        end_date: endQ || null,
        source_kind: sourceFilter,
        truck_driver_query: truckDriverQ || undefined,
        expected_total_cad: expectedForApi,
      }),
    enabled: open && !!category,
  });

  const isUncategorized = category === "uncategorized";

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (!data?.transactions.length) return;
    setSelectedIds(new Set(data.transactions.map((t) => t.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const runBulkAssign = async () => {
    if (selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      await expensesApi.bulkUpdateCategory(Array.from(selectedIds), bulkCategory);
      toast.success(`Updated ${selectedIds.size} expense(s)`);
      clearSelection();
      await queryClient.invalidateQueries({ queryKey: ["summary"] });
      await queryClient.invalidateQueries({ queryKey: ["category-audit"] });
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Bulk update failed");
    } finally {
      setBulkSaving(false);
    }
  };

  const updateRowCategory = async (expenseId: string, newCategory: string) => {
    const row = data?.transactions.find((t) => t.id === expenseId);
    const current = row?.expense.category || "uncategorized";
    if (newCategory === current) return;

    setSavingCategoryId(expenseId);
    try {
      await expensesApi.update(expenseId, { category: newCategory });
      toast.success("Category updated");
      await queryClient.invalidateQueries({ queryKey: ["summary"] });
      await queryClient.invalidateQueries({ queryKey: ["category-audit"] });
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      await refetch();
      if (selected?.id === expenseId && newCategory !== category) {
        setSelected(null);
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not update category");
    } finally {
      setSavingCategoryId(null);
    }
  };

  const maxMonth = useMemo(() => {
    if (!data?.stats.monthly_trend.length) return 1;
    return Math.max(...data.stats.monthly_trend.map((m) => m.total_cad), 1);
  }, [data]);

  if (!open || !category) return null;

  const color = categoryColors[category] || "#6B7280";
  const title = categoryLabels[category] || category;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          aria-label="Close panel"
          onClick={onClose}
        />
        <motion.aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-drawer-title"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          className="relative h-full w-full max-w-xl bg-slate-900 border-l border-slate-700/80 shadow-2xl flex flex-col"
        >
          <header className="flex-shrink-0 border-b border-slate-800 px-4 py-3 flex items-start gap-3">
            {selected ? (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-2 rounded-lg hover:bg-slate-800 text-slate-400"
                aria-label="Back to list"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}22`, color }}
              >
                <Tag className="w-5 h-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2
                id="category-drawer-title"
                className="text-lg font-semibold text-white truncate"
              >
                {selected ? "Transaction audit" : title}
              </h2>
              {!selected && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {expectedCount} in summary · {formatCurrency(expectedTotalCad)} — use the
                  category column to reclassify without leaving the dashboard
                  {isFetching && !isLoading ? " · refreshing…" : ""}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          {selected ? (
            <TransactionAuditPanel
              row={selected}
              categoryColor={color}
              onCloseDetail={() => setSelected(null)}
              drawerCategory={category}
              onChangeCategory={updateRowCategory}
              savingCategoryId={savingCategoryId}
            />
          ) : (
            <>
              <div className="flex-shrink-0 p-4 space-y-3 border-b border-slate-800 overflow-y-auto max-h-[42vh]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">
                      From
                    </label>
                    <input
                      type="date"
                      value={filterStart}
                      onChange={(e) => setFilterStart(e.target.value)}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">
                      To
                    </label>
                    <input
                      type="date"
                      value={filterEnd}
                      onChange={(e) => setFilterEnd(e.target.value)}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">
                    Source
                  </label>
                  <select
                    value={sourceFilter}
                    onChange={(e) =>
                      setSourceFilter(e.target.value as ExpenseSourceKind | "all")
                    }
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="all">All sources</option>
                    <option value="bank">Bank</option>
                    <option value="receipt">Receipt</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">
                    Truck / driver / notes
                  </label>
                  <input
                    type="search"
                    placeholder="Filter vendor or notes…"
                    value={truckDriverQ}
                    onChange={(e) => setTruckDriverQ(e.target.value)}
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white placeholder:text-slate-600"
                  />
                </div>

                {data &&
                  !data.reconciles_with_summary &&
                  filtersMatchDashboard &&
                  expectedForApi !== undefined && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200/90 text-xs">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Filtered total ({formatCurrency(data.total_cad)}) differs from dashboard
                      category total by {formatCurrency(Math.abs(data.summary_delta_cad))}. Adjust
                      date filters or refresh — large imports may require a moment to sync.
                    </span>
                  </div>
                )}

                {data && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-800/80 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Count</p>
                      <p className="text-sm font-semibold text-white">{data.count}</p>
                    </div>
                    <div className="rounded-lg bg-slate-800/80 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Average</p>
                      <p className="text-sm font-semibold text-white">
                        {formatCurrency(data.stats.average_cad)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-800/80 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Largest</p>
                      <p className="text-sm font-semibold text-white truncate">
                        {data.stats.largest
                          ? formatCurrency(data.stats.largest.amount_cad)
                          : "—"}
                      </p>
                    </div>
                  </div>
                )}

                {data && data.stats.monthly_trend.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                      Monthly trend (CAD)
                    </p>
                    <div className="flex items-end gap-1 h-16">
                      {data.stats.monthly_trend.map((m) => (
                        <div
                          key={m.month}
                          className="flex-1 min-w-0 flex flex-col items-center gap-1"
                          title={`${m.label}: ${formatCurrency(m.total_cad)} (${m.count})`}
                        >
                          <div
                            className="w-full rounded-t bg-yel-500/70 hover:bg-yel-500 transition-colors"
                            style={{
                              height: `${Math.max(8, (m.total_cad / maxMonth) * 100)}%`,
                              minHeight: 4,
                            }}
                          />
                          <span className="text-[9px] text-slate-500 truncate w-full text-center">
                            {m.month === "unknown" ? "?" : m.month.slice(5)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isUncategorized && (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
                    <p className="text-xs font-medium text-white">
                      Bulk assign category (or change one-by-one in the table)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={bulkCategory}
                        onChange={(e) => setBulkCategory(e.target.value)}
                        className="flex-1 min-w-[140px] rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                      >
                        {EXPENSE_CATEGORIES.filter((c) => c.id !== "uncategorized").map(
                          (c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          )
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={selectedIds.size === 0 || bulkSaving}
                        onClick={runBulkAssign}
                        className="btn-primary text-sm py-1.5 px-3 disabled:opacity-40"
                      >
                        {bulkSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          `Assign (${selectedIds.size})`
                        )}
                      </button>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-amber-500 hover:text-amber-400"
                        onClick={selectAllVisible}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="text-slate-500 hover:text-slate-400"
                        onClick={clearSelection}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                {isLoading ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="w-8 h-8 text-yel-500 animate-spin" />
                  </div>
                ) : !data?.transactions.length ? (
                  <p className="text-center text-slate-500 py-12 text-sm">
                    No transactions for this view.
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead className="sticky top-0 bg-slate-900/95 backdrop-blur z-10 border-b border-slate-800">
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                        {isUncategorized && (
                          <th className="pl-3 py-2 w-10">
                            <span className="sr-only">Select</span>
                          </th>
                        )}
                        <th className="py-2 pl-1 pr-2">Date</th>
                        <th className="py-2 pr-2 min-w-[120px]">Vendor / description</th>
                        <th className="py-2 pr-2 w-[140px]">Category</th>
                        <th className="py-2 pr-2 text-right">Amount</th>
                        <th className="py-2 pr-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {data.transactions.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-800/40 cursor-pointer group"
                          onClick={() => setSelected(row)}
                        >
                          {isUncategorized && (
                            <td
                              className="pl-3 py-2 align-top"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(row.id)}
                                onChange={() => toggleSelect(row.id)}
                                className="rounded border-slate-600"
                              />
                            </td>
                          )}
                          <td className="py-2 pl-1 pr-2 text-slate-400 whitespace-nowrap align-top text-xs">
                            {row.date ? formatDate(row.date) : "—"}
                          </td>
                          <td className="py-2 pr-2 align-top min-w-0">
                            <p className="text-white font-medium truncate group-hover:text-yel-400">
                              {row.vendor || "Unknown"}
                            </p>
                            <p className="text-[11px] text-slate-500 line-clamp-2">
                              {row.description}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium",
                                  row.source_kind === "bank" && "bg-blue-500/15 text-blue-400",
                                  row.source_kind === "receipt" && "bg-amber-500/15 text-amber-400",
                                  row.source_kind === "manual" && "bg-slate-500/15 text-slate-400"
                                )}
                              >
                                {sourceIcon(row.source_kind)}
                                {sourceLabel(row.source_kind)}
                              </span>
                            </div>
                          </td>
                          <td
                            className="py-2 pr-2 align-top"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <RowCategorySelect
                              value={row.expense.category || "uncategorized"}
                              disabled={savingCategoryId === row.id}
                              onChange={(v) => updateRowCategory(row.id, v)}
                            />
                            {savingCategoryId === row.id && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-yel-500 mt-1" />
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right font-medium text-white align-top whitespace-nowrap">
                            {formatCurrency(row.amount_cad)}
                          </td>
                          <td className="py-2 pr-3 align-top">{statusBadge(row.matching_status)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-700 bg-slate-900/80">
                      <tr>
                        {isUncategorized && <td className="py-2 w-10" />}
                        <td
                          colSpan={3}
                          className="py-2 pl-1 text-slate-400 text-xs font-medium"
                        >
                          Visible total
                        </td>
                        <td className="py-2 pr-2 text-right text-white font-semibold whitespace-nowrap">
                          {formatCurrency(data.total_cad)}
                        </td>
                        <td className="py-2 pr-3 w-24" />
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                )}
              </div>

              <footer className="flex-shrink-0 border-t border-slate-800 p-3">
                <p className="text-[11px] text-slate-500 truncate">
                  Row (outside the category menu) opens audit trail ·{" "}
                  <Link href="/expenses" className="text-yel-500 hover:underline">
                    All expenses
                  </Link>
                </p>
              </footer>
            </>
          )}
        </motion.aside>
      </motion.div>
    </AnimatePresence>
  );
}

function TransactionAuditPanel({
  row,
  categoryColor,
  onCloseDetail,
  drawerCategory,
  onChangeCategory,
  savingCategoryId,
}: {
  row: CategoryAuditTransaction;
  categoryColor: string;
  onCloseDetail: () => void;
  drawerCategory: string | null;
  onChangeCategory: (expenseId: string, newCategory: string) => void;
  savingCategoryId: string | null;
}) {
  const e = row.expense;
  const isPdf =
    (e.receipt_image_url || "").toLowerCase().includes(".pdf") ||
    (e.receipt_image_url || "").toLowerCase().includes("pdf");

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{row.vendor || "Unknown"}</p>
          <p className="text-xs text-slate-500">
            {row.date ? formatDate(row.date, "long") : "No date"} ·{" "}
            {formatCurrency(row.amount_cad)}
          </p>
        </div>
        <Link
          href={`/expenses/${row.id}`}
          className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0 inline-flex items-center gap-1"
          onClick={(ev) => ev.stopPropagation()}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Full page
        </Link>
      </div>

      <section className="card p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Category (quick edit)
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <RowCategorySelect
            value={e.category || "uncategorized"}
            disabled={savingCategoryId === row.id}
            onChange={(v) => onChangeCategory(row.id, v)}
          />
          {savingCategoryId === row.id && (
            <Loader2 className="w-4 h-4 animate-spin text-yel-500" />
          )}
        </div>
        {drawerCategory && (
          <p className="text-[11px] text-slate-500">
            Changing category moves this expense out of “{categoryLabels[drawerCategory] || drawerCategory}” in this list.
          </p>
        )}
      </section>

      <section className="card p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <Landmark className="w-4 h-4" />
          Bank transaction
        </h3>
        {e.entry_type === "bank_import" ||
        e.entry_type === "factoring_import" ||
        e.bank_description ||
        e.bank_statement_date ? (
          <dl className="text-sm space-y-1">
            {e.bank_statement_date && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Statement date</dt>
                <dd className="text-white text-right">{e.bank_statement_date}</dd>
              </div>
            )}
            {e.bank_description && (
              <div>
                <dt className="text-slate-500 text-xs mb-0.5">Description</dt>
                <dd className="text-slate-200 text-sm break-words">{e.bank_description}</dd>
              </div>
            )}
            {e.import_fingerprint && (
              <div className="flex justify-between gap-2 text-xs">
                <dt className="text-slate-500">Import fingerprint</dt>
                <dd className="text-slate-400 font-mono truncate max-w-[180px]" title={e.import_fingerprint}>
                  {e.import_fingerprint}
                </dd>
              </div>
            )}
            {!e.bank_description && !e.bank_statement_date && (
              <p className="text-slate-500 text-sm">No bank line-item stored on this record.</p>
            )}
          </dl>
        ) : (
          <p className="text-slate-500 text-sm">
            This expense was not created from a bank CSV row. Source:{" "}
            <span className="text-slate-300">{row.entry_type}</span>
          </p>
        )}
      </section>

      <section className="card p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <ImageIcon className="w-4 h-4" />
          Receipt
        </h3>
        {e.receipt_image_url ? (
          <div className="space-y-2">
            {isPdf ? (
              <a
                href={e.receipt_image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-yel-500 hover:text-yel-400 text-sm"
              >
                <FileText className="w-4 h-4" />
                Open PDF / document
              </a>
            ) : (
              <a
                href={e.receipt_image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg overflow-hidden border border-slate-700 bg-slate-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={e.receipt_image_url}
                  alt="Receipt"
                  className="w-full max-h-48 object-contain"
                />
              </a>
            )}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No receipt image on file.</p>
        )}
      </section>

      <section className="card p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          AI parsed output (OCR / extraction)
        </h3>
        {e.raw_ocr_text ? (
          <pre className="text-[11px] text-slate-300 bg-slate-950/80 rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
            {e.raw_ocr_text.length > 2000
              ? `${e.raw_ocr_text.slice(0, 2000)}…`
              : e.raw_ocr_text}
          </pre>
        ) : (
          <p className="text-slate-500 text-sm">No OCR text stored.</p>
        )}
      </section>

      <section className="card p-4 space-y-2 border-l-2" style={{ borderColor: categoryColor }}>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          Matching logic
        </h3>
        <ul className="text-sm text-slate-300 space-y-1 list-disc pl-4">
          <li>
            Entry type: <span className="text-white">{row.entry_type}</span> → source{" "}
            <span className="text-white">{sourceLabel(row.source_kind)}</span>
          </li>
          <li>
            Matching status:{" "}
            <span className="text-white">{row.matching_status.replace(/_/g, " ")}</span>
          </li>
          {e.bank_match_reason != null && e.bank_match_reason !== "" && (
            <li>
              Bank match reason:{" "}
              <span className="text-white">{String(e.bank_match_reason)}</span>
            </li>
          )}
          {e.bank_match_score != null && (
            <li>
              Bank match score: <span className="text-white">{e.bank_match_score}</span>
            </li>
          )}
          {e.receipt_linked && (
            <li>Receipt was linked to this bank line (receipt_linked).</li>
          )}
          {e.bank_linked && <li>Receipt record was linked to a bank import (bank_linked).</li>}
        </ul>
      </section>

      <button type="button" onClick={onCloseDetail} className="btn-secondary w-full text-sm">
        Back to list
      </button>
    </div>
  );
}
