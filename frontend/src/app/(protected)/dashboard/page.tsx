"use client";

import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  DollarSign,
  Receipt,
  TrendingUp,
  ArrowUpRight,
  Fuel,
  Wrench,
  UtensilsCrossed,
  Bed,
  Scale,
  FileText,
  FileCheck,
  HelpCircle,
  Plus,
  Upload,
  Calculator,
  Download,
  Shield,
  Percent,
  Users,
  Calendar,
  ChevronDown,
  ChevronRight,
  Building2,
  CreditCard,
  Landmark,
  ArrowLeftRight,
  X,
  Image as ImageIcon,
  Link as LinkIcon,
} from "lucide-react";
import Link from "next/link";
import { exportApi, expensesApi, revenueApi } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";

const categoryIcons: Record<string, React.ReactNode> = {
  fuel: <Fuel className="w-5 h-5" />,
  maintenance_repairs: <Wrench className="w-5 h-5" />,
  insurance: <Shield className="w-5 h-5" />,
  meals_entertainment: <UtensilsCrossed className="w-5 h-5" />,
  travel_lodging: <Bed className="w-5 h-5" />,
  tolls_scales: <Scale className="w-5 h-5" />,
  office_admin: <FileText className="w-5 h-5" />,
  licenses_dues: <FileCheck className="w-5 h-5" />,
  factoring_fees: <Percent className="w-5 h-5" />,
  payroll: <Users className="w-5 h-5" />,
  subcontractor: <Users className="w-5 h-5" />,
  professional_fees: <FileCheck className="w-5 h-5" />,
  rent_lease: <FileText className="w-5 h-5" />,
  loan_interest: <DollarSign className="w-5 h-5" />,
  other_expenses: <HelpCircle className="w-5 h-5" />,
  uncategorized: <HelpCircle className="w-5 h-5" />,
};

// Period presets
type PeriodPreset = "all" | "2025" | "2026" | "q1_2025" | "q2_2025" | "q3_2025" | "q4_2025" | "q1_2026" | "q2_2026" | "custom";

interface PeriodOption {
  id: PeriodPreset;
  label: string;
  shortLabel: string;
  start: string | null;
  end: string | null;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { id: "all", label: "All Time", shortLabel: "All Time", start: null, end: null },
  { id: "2025", label: "Fiscal Year 2025", shortLabel: "FY 2025", start: "2025-01-01", end: "2025-12-31" },
  { id: "2026", label: "Fiscal Year 2026", shortLabel: "FY 2026", start: "2026-01-01", end: "2026-12-31" },
  { id: "q1_2025", label: "Q1 2025 (Jan-Mar)", shortLabel: "Q1 2025", start: "2025-01-01", end: "2025-03-31" },
  { id: "q2_2025", label: "Q2 2025 (Apr-Jun)", shortLabel: "Q2 2025", start: "2025-04-01", end: "2025-06-30" },
  { id: "q3_2025", label: "Q3 2025 (Jul-Sep)", shortLabel: "Q3 2025", start: "2025-07-01", end: "2025-09-30" },
  { id: "q4_2025", label: "Q4 2025 (Oct-Dec)", shortLabel: "Q4 2025", start: "2025-10-01", end: "2025-12-31" },
  { id: "q1_2026", label: "Q1 2026 (Jan-Mar)", shortLabel: "Q1 2026", start: "2026-01-01", end: "2026-03-31" },
  { id: "q2_2026", label: "Q2 2026 (Apr-Jun)", shortLabel: "Q2 2026", start: "2026-04-01", end: "2026-06-30" },
];

type DrillDownType = "cad_revenue" | "usd_revenue" | "cad_expense" | "usd_expense" | null;

export default function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodPreset>("all");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const [drillDown, setDrillDown] = useState<DrillDownType>(null);

  const currentPeriod = PERIOD_OPTIONS.find((p) => p.id === selectedPeriod) || PERIOD_OPTIONS[0];

  // Build date params for queries
  const dateParams = useMemo(() => {
    if (!currentPeriod.start) return {};
    return {
      start_date: currentPeriod.start,
      end_date: currentPeriod.end || undefined,
    };
  }, [currentPeriod]);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["summary", selectedPeriod],
    queryFn: () => exportApi.getSummary(dateParams),
  });

  const { data: revenueSummary, isLoading: revenueLoading } = useQuery({
    queryKey: ["revenue-summary", selectedPeriod],
    queryFn: async () => {
      // Revenue summary doesn't have date params built-in, so we filter client-side
      const all = await revenueApi.list({ per_page: 1000 });
      let revenues = all.revenues.filter((r) => r.status === "verified");

      if (currentPeriod.start) {
        const startDate = new Date(currentPeriod.start);
        revenues = revenues.filter(
          (r) => r.date && new Date(r.date) >= startDate
        );
      }
      if (currentPeriod.end) {
        const endDate = new Date(currentPeriod.end);
        endDate.setHours(23, 59, 59, 999);
        revenues = revenues.filter(
          (r) => r.date && new Date(r.date) <= endDate
        );
      }

      const totalCad = revenues.reduce(
        (sum, r) => sum + (r.amount_cad || 0),
        0
      );
      
      // USD revenue breakdown
      const usdRevenues = revenues.filter((r) => r.currency === "USD");
      const cadRevenues = revenues.filter((r) => r.currency !== "USD");
      const totalOriginalUsd = usdRevenues.reduce(
        (sum, r) => sum + (r.amount_original || 0),
        0
      );
      const totalUsdConvertedCad = usdRevenues.reduce(
        (sum, r) => sum + (r.amount_cad || 0),
        0
      );
      const totalOriginalCad = cadRevenues.reduce(
        (sum, r) => sum + (r.amount_cad || r.amount_original || 0),
        0
      );

      return {
        total_cad: totalCad,
        total_usd: totalOriginalUsd,
        total_usd_converted_cad: totalUsdConvertedCad,
        total_original_cad: totalOriginalCad,
        usd_count: usdRevenues.length,
        cad_count: cadRevenues.length,
        count: all.revenues.length,
        verified_count: revenues.length,
        // Individual items for drill-down
        usd_items: usdRevenues,
        cad_items: cadRevenues,
      };
    },
  });

  const { data: recentExpenses, isLoading: expensesLoading } = useQuery({
    queryKey: ["expenses", "recent", selectedPeriod],
    queryFn: async () => {
      const all = await expensesApi.list({ per_page: 1000 });
      let expenses = all.expenses;

      if (currentPeriod.start) {
        const startDate = new Date(currentPeriod.start);
        expenses = expenses.filter(
          (e) => e.transaction_date && new Date(e.transaction_date) >= startDate
        );
      }
      if (currentPeriod.end) {
        const endDate = new Date(currentPeriod.end);
        endDate.setHours(23, 59, 59, 999);
        expenses = expenses.filter(
          (e) => e.transaction_date && new Date(e.transaction_date) <= endDate
        );
      }

      // Sort by date descending
      expenses.sort((a, b) => {
        const da = a.transaction_date
          ? new Date(a.transaction_date).getTime()
          : 0;
        const db = b.transaction_date
          ? new Date(b.transaction_date).getTime()
          : 0;
        return db - da;
      });

      // Currency split for drill-down
      const cadExpenses = expenses.filter((e: any) => (e.original_currency || "CAD") !== "USD");
      const usdExpenses = expenses.filter((e: any) => (e.original_currency || "CAD") === "USD");

      return {
        expenses: expenses.slice(0, 5),
        total: expenses.length,
        // For drill-down
        cad_items: cadExpenses,
        usd_items: usdExpenses,
      };
    },
  });

  // Calculate profitability metrics
  const grossRevenue = revenueSummary?.total_cad || 0;
  const totalExpenses = summary?.totals?.total_cad || 0;
  const netProfit = grossRevenue - totalExpenses;

  // Payment source breakdown
  const bankChecking = summary?.by_payment_source?.bank_checking || 0;
  const eTransfer = summary?.by_payment_source?.e_transfer || 0;
  const companyCard = summary?.by_payment_source?.company_expenses || 0;
  const personalCard = summary?.by_payment_source?.due_to_shareholder || 0;

  return (
    <div className="space-y-8">
      {/* Page Header with Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">
            Dashboard
          </h1>
          <p className="text-slate-400 mt-1">
            Track your business at a glance
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Period Selector */}
          <div className="relative">
            <button
              onClick={() => setShowPeriodMenu(!showPeriodMenu)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              <Calendar className="w-4 h-4 text-amber-500" />
              {currentPeriod.shortLabel}
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-slate-400 transition-transform",
                  showPeriodMenu && "rotate-180"
                )}
              />
            </button>

            {showPeriodMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowPeriodMenu(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute right-0 top-full mt-2 z-50 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden"
                >
                  <div className="p-2 border-b border-slate-700">
                    <p className="text-xs text-slate-500 px-2 py-1">
                      Select Period
                    </p>
                  </div>
                  <div className="p-1 max-h-[300px] overflow-y-auto">
                    {PERIOD_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setSelectedPeriod(opt.id);
                          setShowPeriodMenu(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors",
                          selectedPeriod === opt.id
                            ? "bg-amber-500/10 text-amber-500"
                            : "text-slate-300 hover:bg-slate-700"
                        )}
                      >
                        <span>{opt.label}</span>
                        {selectedPeriod === opt.id && (
                          <div className="w-2 h-2 rounded-full bg-amber-500" />
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </div>

          <Link href="/revenue" className="btn-secondary">
            <DollarSign className="w-5 h-5" />
            Add Revenue
          </Link>
          <Link href="/upload" className="btn-primary">
            <Upload className="w-5 h-5" />
            Upload Receipt
          </Link>
        </div>
      </div>

      {/* Period Banner */}
      {selectedPeriod !== "all" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl"
        >
          <Calendar className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-400">
            Showing data for{" "}
            <span className="font-bold">{currentPeriod.label}</span>
            {currentPeriod.start && (
              <span className="text-amber-500/70">
                {" "}
                ({currentPeriod.start} to {currentPeriod.end})
              </span>
            )}
          </p>
          <button
            onClick={() => setSelectedPeriod("all")}
            className="ml-auto text-xs text-amber-500 hover:text-amber-400 font-medium"
          >
            Show All
          </button>
        </motion.div>
      )}

      {/* Profitability Summary - Top Level */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-5 bg-gradient-to-br from-emerald-900/20 to-emerald-800/10 border-emerald-500/20"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-emerald-400 mb-1">Gross Revenue</p>
              {revenueLoading ? (
                <div className="h-8 w-24 bg-slate-800 rounded animate-pulse" />
              ) : (
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(grossRevenue)}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                All converted to CAD &middot; {revenueSummary?.verified_count || 0} loads
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-500">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="card p-5 bg-gradient-to-br from-red-900/20 to-red-800/10 border-red-500/20"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-red-400 mb-1">Total Expenses</p>
              {summaryLoading ? (
                <div className="h-8 w-24 bg-slate-800 rounded animate-pulse" />
              ) : (
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(totalExpenses)}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                {summary?.totals?.expense_count || 0} verified &middot; all in CAD
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center text-red-500">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={cn(
            "card p-5 border",
            netProfit >= 0
              ? "bg-gradient-to-br from-blue-900/20 to-blue-800/10 border-blue-500/20"
              : "bg-gradient-to-br from-orange-900/20 to-orange-800/10 border-orange-500/20"
          )}
        >
          <div className="flex items-start justify-between">
            <div>
              <p
                className={cn(
                  "text-sm mb-1",
                  netProfit >= 0 ? "text-blue-400" : "text-orange-400"
                )}
              >
                Net Profit
              </p>
              {summaryLoading || revenueLoading ? (
                <div className="h-8 w-24 bg-slate-800 rounded animate-pulse" />
              ) : (
                <p
                  className={cn(
                    "text-2xl font-bold",
                    netProfit >= 0 ? "text-white" : "text-orange-400"
                  )}
                >
                  {formatCurrency(netProfit)}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">Revenue - Expenses</p>
            </div>
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                netProfit >= 0
                  ? "bg-blue-500/20 text-blue-500"
                  : "bg-orange-500/20 text-orange-500"
              )}
            >
              <Calculator className="w-5 h-5" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Currency Breakdown */}
      {!summaryLoading && !revenueLoading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-amber-500" />
            Currency Breakdown
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            All amounts are converted to CAD using Bank of Canada daily exchange rates. Click any box to see individual entries.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Revenue by Currency */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3">Revenue</h3>
              <div className="space-y-3">
                {(revenueSummary?.cad_count || 0) > 0 && (
                  <CurrencyBox
                    currencyCode="CA"
                    currencyColor="emerald"
                    title="CAD Revenue"
                    subtitle={`${revenueSummary?.cad_count || 0} entries`}
                    amount={formatCurrency(revenueSummary?.total_original_cad || 0)}
                    isExpanded={drillDown === "cad_revenue"}
                    onClick={() => setDrillDown(drillDown === "cad_revenue" ? null : "cad_revenue")}
                  />
                )}
                {drillDown === "cad_revenue" && (
                  <CurrencyDrillDown
                    items={(revenueSummary?.cad_items || []).map((r: any) => ({
                      id: r.id,
                      vendor: r.broker_name || "Unknown",
                      date: r.date,
                      amount: r.amount_cad || r.amount_original || 0,
                      originalAmount: r.amount_original || 0,
                      currency: "CAD",
                      source: r.entry_type || "manual",
                      category: r.load_id ? `Load #${r.load_id}` : undefined,
                      hasReceipt: !!r.image_url,
                    }))}
                    onClose={() => setDrillDown(null)}
                  />
                )}
                {(revenueSummary?.usd_count || 0) > 0 && (
                  <CurrencyBox
                    currencyCode="US"
                    currencyColor="blue"
                    title="USD Revenue"
                    subtitle={`${revenueSummary?.usd_count || 0} entries · $${(revenueSummary?.total_usd || 0).toLocaleString("en-CA", { minimumFractionDigits: 2 })} USD`}
                    amount={formatCurrency(revenueSummary?.total_usd_converted_cad || 0)}
                    amountSub="converted CAD"
                    isExpanded={drillDown === "usd_revenue"}
                    onClick={() => setDrillDown(drillDown === "usd_revenue" ? null : "usd_revenue")}
                  />
                )}
                {drillDown === "usd_revenue" && (
                  <CurrencyDrillDown
                    items={(revenueSummary?.usd_items || []).map((r: any) => ({
                      id: r.id,
                      vendor: r.broker_name || "Unknown",
                      date: r.date,
                      amount: r.amount_cad || 0,
                      originalAmount: r.amount_original || 0,
                      currency: "USD",
                      exchangeRate: r.exchange_rate,
                      source: r.entry_type || "manual",
                      category: r.load_id ? `Load #${r.load_id}` : undefined,
                      hasReceipt: !!r.image_url,
                    }))}
                    onClose={() => setDrillDown(null)}
                  />
                )}
                {(revenueSummary?.verified_count || 0) === 0 && (
                  <p className="text-sm text-slate-500 text-center py-2">No revenue data</p>
                )}
              </div>
            </div>

            {/* Expenses by Currency */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3">Expenses</h3>
              <div className="space-y-3">
                {(summary?.by_currency?.cad?.count || 0) > 0 && (
                  <CurrencyBox
                    currencyCode="CA"
                    currencyColor="emerald"
                    title="CAD Expenses"
                    subtitle={`${summary?.by_currency?.cad?.count || 0} entries`}
                    amount={formatCurrency(summary?.by_currency?.cad?.original_total || 0)}
                    isExpanded={drillDown === "cad_expense"}
                    onClick={() => setDrillDown(drillDown === "cad_expense" ? null : "cad_expense")}
                  />
                )}
                {drillDown === "cad_expense" && (
                  <CurrencyDrillDown
                    items={(recentExpenses?.cad_items || []).map((e: any) => ({
                      id: e.id,
                      vendor: e.vendor_name || "Unknown",
                      date: e.transaction_date,
                      amount: e.cad_amount || 0,
                      originalAmount: e.original_amount || e.cad_amount || 0,
                      currency: "CAD",
                      source: e.entry_type || (e.bank_linked ? "bank_linked" : "manual"),
                      category: categoryLabels[e.category] || e.category,
                      hasReceipt: !!e.receipt_image_url,
                      gst: e.gst_amount,
                      hst: e.hst_amount,
                      pst: e.pst_amount,
                    }))}
                    onClose={() => setDrillDown(null)}
                    linkBase="/expenses"
                  />
                )}
                {(summary?.by_currency?.usd?.count || 0) > 0 && (
                  <CurrencyBox
                    currencyCode="US"
                    currencyColor="blue"
                    title="USD Expenses"
                    subtitle={`${summary?.by_currency?.usd?.count || 0} entries · $${(summary?.by_currency?.usd?.original_total || 0).toLocaleString("en-CA", { minimumFractionDigits: 2 })} USD`}
                    amount={formatCurrency(summary?.by_currency?.usd?.converted_cad || 0)}
                    amountSub={`avg rate: ${(summary?.by_currency?.usd?.avg_rate || 0).toFixed(4)}`}
                    isExpanded={drillDown === "usd_expense"}
                    onClick={() => setDrillDown(drillDown === "usd_expense" ? null : "usd_expense")}
                  />
                )}
                {drillDown === "usd_expense" && (
                  <CurrencyDrillDown
                    items={(recentExpenses?.usd_items || []).map((e: any) => ({
                      id: e.id,
                      vendor: e.vendor_name || "Unknown",
                      date: e.transaction_date,
                      amount: e.cad_amount || 0,
                      originalAmount: e.original_amount || 0,
                      currency: "USD",
                      exchangeRate: e.exchange_rate,
                      source: e.entry_type || (e.bank_linked ? "bank_linked" : "manual"),
                      category: categoryLabels[e.category] || e.category,
                      hasReceipt: !!e.receipt_image_url,
                      gst: e.gst_amount,
                      hst: e.hst_amount,
                      pst: e.pst_amount,
                    }))}
                    onClose={() => setDrillDown(null)}
                    linkBase="/expenses"
                  />
                )}
                {(summary?.totals?.expense_count || 0) === 0 && (
                  <p className="text-sm text-slate-500 text-center py-2">No expense data</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(summary?.totals?.total_cad)}
          subtitle="All verified expenses"
          icon={<DollarSign className="w-5 h-5" />}
          color="yel"
          loading={summaryLoading}
        />
        <StatCard
          title="Receipts"
          value={summary?.totals?.expense_count?.toString() || "0"}
          subtitle="Total uploaded"
          icon={<Receipt className="w-5 h-5" />}
          color="blue"
          loading={summaryLoading}
        />
        <StatCard
          title="Recoverable GST/HST"
          value={formatCurrency(summary?.totals?.total_tax_recoverable)}
          subtitle="ITC eligible"
          icon={<TrendingUp className="w-5 h-5" />}
          color="green"
          loading={summaryLoading}
          tooltip={
            summary?.totals
              ? `GST: ${formatCurrency(summary.totals.total_gst)} | HST: ${formatCurrency(summary.totals.total_hst)} | PST: ${formatCurrency(summary.totals.total_pst)}`
              : undefined
          }
        />
        <StatCard
          title="Tax Deductions"
          value={formatCurrency(summary?.totals?.total_potential_deductions)}
          subtitle="T2125 eligible"
          icon={<Calculator className="w-5 h-5" />}
          color="cyan"
          loading={summaryLoading}
          tooltip="This amount will be deducted from your tax base. Meal expenses are calculated at 50%, uncategorized ones at 0%."
        />
        <StatCard
          title="Due to Shareholder"
          value={formatCurrency(
            summary?.by_payment_source?.due_to_shareholder
          )}
          subtitle="Personal card expenses"
          icon={<ArrowUpRight className="w-5 h-5" />}
          color="purple"
          loading={summaryLoading}
        />
      </div>

      {/* Payment Source Breakdown */}
      {!summaryLoading && totalExpenses > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">
            Expenses by Payment Method
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <PaymentMethodCard
              icon={<CreditCard className="w-5 h-5" />}
              label="Company Card"
              amount={companyCard}
              total={totalExpenses}
              color="blue"
            />
            <PaymentMethodCard
              icon={<ArrowUpRight className="w-5 h-5" />}
              label="Personal Card"
              amount={personalCard}
              total={totalExpenses}
              color="purple"
            />
            <PaymentMethodCard
              icon={<Landmark className="w-5 h-5" />}
              label="Bank / Checking"
              amount={bankChecking}
              total={totalExpenses}
              color="emerald"
            />
            <PaymentMethodCard
              icon={<ArrowLeftRight className="w-5 h-5" />}
              label="e-Transfer"
              amount={eTransfer}
              total={totalExpenses}
              color="amber"
            />
          </div>
        </motion.div>
      )}

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Category Breakdown */}
        <div className="lg:col-span-2 card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Expenses by Category
          </h2>
          <div className="space-y-3">
            {summaryLoading ? (
              <LoadingSkeleton count={5} />
            ) : summary?.by_category ? (
              Object.entries(summary.by_category)
                .sort(([, a]: [string, any], [, b]: [string, any]) => b.total_cad - a.total_cad)
                .map(([category, data]: [string, any]) => (
                  <CategoryBar
                    key={category}
                    category={category}
                    amount={data.total_cad}
                    count={data.count}
                    total={summary.totals.total_cad}
                  />
                ))
            ) : (
              <EmptyState message="No expenses yet" />
            )}
          </div>
        </div>

        {/* Recent Expenses */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent</h2>
            <Link
              href="/expenses"
              className="text-sm text-amber-500 hover:text-amber-400 transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {expensesLoading ? (
              <LoadingSkeleton count={5} />
            ) : (recentExpenses?.expenses?.length ?? 0) > 0 ? (
              recentExpenses?.expenses?.map((expense: any) => (
                <Link
                  key={expense.id}
                  href={`/expenses/${expense.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{
                        backgroundColor: `${
                          categoryColors[expense.category] || "#6B7280"
                        }20`,
                        color:
                          categoryColors[expense.category] || "#6B7280",
                      }}
                    >
                      {categoryIcons[expense.category] || (
                        <HelpCircle className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-amber-500 transition-colors">
                        {expense.vendor_name || "Unknown Vendor"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(expense.transaction_date)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {formatCurrency(expense.cad_amount)}
                  </p>
                </Link>
              ))
            ) : (
              <EmptyState message="No recent expenses" />
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <QuickAction
            href="/upload"
            icon={<Upload className="w-6 h-6" />}
            label="Upload Receipt"
          />
          <QuickAction
            href="/import"
            icon={<Download className="w-6 h-6" />}
            label="Import Data"
          />
          <QuickAction
            href="/expenses?filter=unverified"
            icon={<Receipt className="w-6 h-6" />}
            label="Review Pending"
          />
          <QuickAction
            href="/export"
            icon={<FileText className="w-6 h-6" />}
            label="Export Data"
          />
          <QuickAction
            href="/cards"
            icon={<Plus className="w-6 h-6" />}
            label="Manage Cards"
          />
        </div>
      </div>
    </div>
  );
}

function PaymentMethodCard({
  icon,
  label,
  amount,
  total,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
  total: number;
  color: "blue" | "purple" | "emerald" | "amber";
}) {
  const percentage = total > 0 ? (amount / total) * 100 : 0;
  const colorClasses = {
    blue: { bg: "bg-blue-500/10", text: "text-blue-400", bar: "bg-blue-500" },
    purple: {
      bg: "bg-purple-500/10",
      text: "text-purple-400",
      bar: "bg-purple-500",
    },
    emerald: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-400",
      bar: "bg-emerald-500",
    },
    amber: {
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      bar: "bg-amber-500",
    },
  };
  const c = colorClasses[color];

  return (
    <div className="p-4 rounded-xl bg-slate-800/50">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            c.bg,
            c.text
          )}
        >
          {icon}
        </div>
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <p className="text-lg font-bold text-white">{formatCurrency(amount)}</p>
      <div className="mt-2">
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5 }}
            className={cn("h-full rounded-full", c.bar)}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {percentage.toFixed(1)}% of total
        </p>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  loading,
  tooltip,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  color: "yel" | "blue" | "green" | "purple" | "cyan";
  loading?: boolean;
  tooltip?: string;
}) {
  const [showTooltip, setShowTooltip] = React.useState(false);

  const colorClasses = {
    yel: "from-amber-500/20 to-amber-600/10 text-amber-500",
    blue: "from-blue-500/20 to-blue-600/10 text-blue-500",
    green: "from-emerald-500/20 to-emerald-600/10 text-emerald-500",
    purple: "from-purple-500/20 to-purple-600/10 text-purple-500",
    cyan: "from-cyan-500/20 to-cyan-600/10 text-cyan-500",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5 relative"
      onMouseEnter={() => tooltip && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {tooltip && showTooltip && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 px-3 py-2 bg-slate-700 text-white text-xs rounded-lg shadow-lg whitespace-nowrap"
        >
          {tooltip}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-700 rotate-45" />
        </motion.div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 mb-1">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-slate-800 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-white">{value}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div
          className={cn(
            "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center",
            colorClasses[color]
          )}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

function CategoryBar({
  category,
  amount,
  count,
  total,
}: {
  category: string;
  amount: number;
  count: number;
  total: number;
}) {
  const percentage = total > 0 ? (amount / total) * 100 : 0;
  const color = categoryColors[category] || "#6B7280";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm text-slate-300">
            {categoryLabels[category] || category}
          </span>
          <span className="text-xs text-slate-500">({count})</span>
        </div>
        <span className="text-sm font-medium text-white">
          {formatCurrency(amount)}
        </span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-3 p-4 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-amber-500/30 transition-all group"
    >
      <div className="text-slate-400 group-hover:text-amber-500 transition-colors">
        {icon}
      </div>
      <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
        {label}
      </span>
    </Link>
  );
}

function LoadingSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-12 bg-slate-800 rounded-xl animate-pulse" />
      ))}
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8">
      <Receipt className="w-12 h-12 text-slate-700 mx-auto mb-3" />
      <p className="text-slate-500">{message}</p>
      <Link
        href="/upload"
        className="text-amber-500 text-sm hover:text-amber-400"
      >
        Upload your first receipt
      </Link>
    </div>
  );
}

// Currency Breakdown clickable box
function CurrencyBox({
  currencyCode,
  currencyColor,
  title,
  subtitle,
  amount,
  amountSub,
  isExpanded,
  onClick,
}: {
  currencyCode: string;
  currencyColor: "emerald" | "blue";
  title: string;
  subtitle: string;
  amount: string;
  amountSub?: string;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const colorClasses = {
    emerald: "bg-emerald-500/10 text-emerald-400",
    blue: "bg-blue-500/10 text-blue-400",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between p-3 rounded-xl transition-all text-left",
        isExpanded
          ? "bg-slate-700/50 ring-1 ring-amber-500/30"
          : "bg-slate-800/50 hover:bg-slate-800"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
            colorClasses[currencyColor]
          )}
        >
          {currencyCode}
        </span>
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="text-sm font-bold text-white">{amount}</p>
          {amountSub && <p className="text-xs text-slate-500">{amountSub}</p>}
        </div>
        <ChevronRight
          className={cn(
            "w-4 h-4 text-slate-500 transition-transform",
            isExpanded && "rotate-90"
          )}
        />
      </div>
    </button>
  );
}

// Drill-down detail panel
interface DrillDownItem {
  id: string;
  vendor: string;
  date: string | Date | null;
  amount: number;
  originalAmount: number;
  currency: string;
  exchangeRate?: number;
  source: string;
  category?: string;
  hasReceipt?: boolean;
  gst?: number;
  hst?: number;
  pst?: number;
}

function CurrencyDrillDown({
  items,
  onClose,
  linkBase,
}: {
  items: DrillDownItem[];
  onClose: () => void;
  linkBase?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_SHOW = 15;
  const displayItems = showAll ? items : items.slice(0, INITIAL_SHOW);

  const sourceLabel = (s: string) => {
    switch (s) {
      case "bank_import": return "Bank CSV";
      case "ocr": return "Receipt OCR";
      case "manual": return "Manual";
      case "bank_linked": return "Bank + Receipt";
      case "factoring": return "Factoring";
      default: return s;
    }
  };

  const sourceColor = (s: string) => {
    switch (s) {
      case "bank_import": return "bg-blue-500/10 text-blue-400";
      case "ocr": return "bg-amber-500/10 text-amber-400";
      case "manual": return "bg-slate-500/10 text-slate-400";
      case "bank_linked": return "bg-emerald-500/10 text-emerald-400";
      case "factoring": return "bg-purple-500/10 text-purple-400";
      default: return "bg-slate-500/10 text-slate-400";
    }
  };

  // Group by source for summary
  const sourceSummary = items.reduce((acc: Record<string, { count: number; total: number }>, item) => {
    const key = item.source;
    if (!acc[key]) acc[key] = { count: 0, total: 0 };
    acc[key].count++;
    acc[key].total += item.amount;
    return acc;
  }, {});

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 overflow-hidden">
          {/* Source summary bar */}
          <div className="px-4 py-3 bg-slate-800/50 border-b border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                Source Breakdown ({items.length} entries)
              </p>
              <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition-colors">
                <X className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(sourceSummary).map(([src, data]) => (
                <span
                  key={src}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium",
                    sourceColor(src)
                  )}
                >
                  {sourceLabel(src)}
                  <span className="opacity-70">({data.count})</span>
                  <span className="opacity-50">·</span>
                  <span>{formatCurrency(data.total)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Entries list */}
          <div className="divide-y divide-slate-800/50">
            {displayItems.map((item, idx) => {
              const content = (
                <div
                  key={item.id || idx}
                  className={cn(
                    "px-4 py-3 flex items-center gap-3 transition-colors",
                    linkBase ? "hover:bg-slate-700/30" : ""
                  )}
                >
                  {/* Source indicator */}
                  <div className="flex-shrink-0">
                    {item.hasReceipt ? (
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-amber-400" />
                      </div>
                    ) : item.source === "bank_linked" ? (
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <LinkIcon className="w-4 h-4 text-emerald-400" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                    )}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{item.vendor}</p>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0", sourceColor(item.source))}>
                        {sourceLabel(item.source)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">{formatDate(item.date)}</span>
                      {item.category && (
                        <>
                          <span className="text-xs text-slate-600">·</span>
                          <span className="text-xs text-slate-500">{item.category}</span>
                        </>
                      )}
                      {(item.gst || item.hst || item.pst) ? (
                        <>
                          <span className="text-xs text-slate-600">·</span>
                          <span className="text-xs text-emerald-500/70">
                            Tax: {formatCurrency((item.gst || 0) + (item.hst || 0) + (item.pst || 0))}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-white">{formatCurrency(item.amount)}</p>
                    {item.currency === "USD" && item.exchangeRate && (
                      <p className="text-[10px] text-slate-500">
                        ${item.originalAmount.toFixed(2)} USD × {item.exchangeRate.toFixed(4)}
                      </p>
                    )}
                  </div>
                </div>
              );

              return linkBase ? (
                <Link key={item.id || idx} href={`${linkBase}/${item.id}`}>
                  {content}
                </Link>
              ) : (
                <div key={item.id || idx}>{content}</div>
              );
            })}
          </div>

          {/* Show more / less */}
          {items.length > INITIAL_SHOW && (
            <div className="px-4 py-2 border-t border-slate-700/30">
              <button
                onClick={() => setShowAll(!showAll)}
                className="w-full text-center text-xs text-amber-500 hover:text-amber-400 py-1 font-medium"
              >
                {showAll
                  ? "Show less"
                  : `Show all ${items.length} entries (${items.length - INITIAL_SHOW} more)`}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
