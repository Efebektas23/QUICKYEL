"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
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
} from "lucide-react";
import Link from "next/link";
import { exportApi, expensesApi, revenueApi } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";

const categoryIcons: Record<string, React.ReactNode> = {
  fuel: <Fuel className="w-5 h-5" />,
  maintenance_repairs: <Wrench className="w-5 h-5" />,
  meals_entertainment: <UtensilsCrossed className="w-5 h-5" />,
  travel_lodging: <Bed className="w-5 h-5" />,
  tolls_scales: <Scale className="w-5 h-5" />,
  office_admin: <FileText className="w-5 h-5" />,
  licenses_dues: <FileCheck className="w-5 h-5" />,
  uncategorized: <HelpCircle className="w-5 h-5" />,
};

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["summary"],
    queryFn: () => exportApi.getSummary(),
  });

  const { data: revenueSummary, isLoading: revenueLoading } = useQuery({
    queryKey: ["revenue-summary"],
    queryFn: () => revenueApi.getSummary(),
  });

  const { data: recentExpenses, isLoading: expensesLoading } = useQuery({
    queryKey: ["expenses", "recent"],
    queryFn: () => expensesApi.list({ per_page: 5 }),
  });

  // Calculate profitability metrics
  const grossRevenue = revenueSummary?.total_cad || 0;
  const totalExpenses = summary?.totals?.total_cad || 0;
  const netProfit = grossRevenue - totalExpenses;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">
            Dashboard
          </h1>
          <p className="text-slate-400 mt-1">
            Track your business at a glance
          </p>
        </div>
        <div className="flex gap-2">
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
              <p className="text-xs text-slate-500 mt-1">Total income (CAD)</p>
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
              <p className="text-xs text-slate-500 mt-1">All verified (CAD)</p>
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
              <p className={cn("text-sm mb-1", netProfit >= 0 ? "text-blue-400" : "text-orange-400")}>
                Net Profit
              </p>
              {summaryLoading || revenueLoading ? (
                <div className="h-8 w-24 bg-slate-800 rounded animate-pulse" />
              ) : (
                <p className={cn("text-2xl font-bold", netProfit >= 0 ? "text-white" : "text-orange-400")}>
                  {formatCurrency(netProfit)}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">Revenue - Expenses</p>
            </div>
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              netProfit >= 0 ? "bg-blue-500/20 text-blue-500" : "bg-orange-500/20 text-orange-500"
            )}>
              <Calculator className="w-5 h-5" />
            </div>
          </div>
        </motion.div>
      </div>

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
              ? `GST/HST: ${formatCurrency(summary.totals.total_gst)} | PST: ${formatCurrency(summary.totals.total_pst)}`
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
              Object.entries(summary.by_category).map(
                ([category, data]: [string, any]) => (
                  <CategoryBar
                    key={category}
                    category={category}
                    amount={data.total_cad}
                    count={data.count}
                    total={summary.totals.total_cad}
                  />
                )
              )
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
                        color: categoryColors[expense.category] || "#6B7280",
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
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickAction
            href="/upload"
            icon={<Upload className="w-6 h-6" />}
            label="Upload Receipt"
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
      {/* Tooltip */}
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
      <Link href="/upload" className="text-amber-500 text-sm hover:text-amber-400">
        Upload your first receipt
      </Link>
    </div>
  );
}

