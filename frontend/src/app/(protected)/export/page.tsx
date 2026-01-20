"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Calendar,
  Loader2,
  TrendingUp,
  DollarSign,
  Receipt,
  PieChart,
} from "lucide-react";
import toast from "react-hot-toast";
import { exportApi } from "@/lib/firebase-api";
import { formatCurrency, downloadBlob, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";

export default function ExportPage() {
  const [dateRange, setDateRange] = useState<{
    start_date?: string;
    end_date?: string;
  }>({});
  const [isExporting, setIsExporting] = useState<"csv" | "xlsx" | null>(null);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["summary", dateRange],
    queryFn: () => exportApi.getSummary(dateRange),
  });

  const handleExport = async (format: "csv" | "xlsx") => {
    setIsExporting(format);
    try {
      const blob =
        format === "csv"
          ? await exportApi.downloadCSV({ ...dateRange, verified_only: true })
          : await exportApi.downloadXLSX({ ...dateRange, verified_only: true });

      const filename = `expenses_${new Date().toISOString().split("T")[0]}.${format}`;
      downloadBlob(blob, filename);
      toast.success(`Exported to ${format.toUpperCase()}`);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Export failed");
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white">
          Export Data
        </h1>
        <p className="text-slate-400 mt-1">
          Generate reports for your accountant
        </p>
      </div>

      {/* Date Range Selector */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-yel-500" />
          Select Date Range
        </h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-slate-400 mb-1 block">
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.start_date || ""}
              onChange={(e) =>
                setDateRange({ ...dateRange, start_date: e.target.value })
              }
              className="input-field"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">
              End Date
            </label>
            <input
              type="date"
              value={dateRange.end_date || ""}
              onChange={(e) =>
                setDateRange({ ...dateRange, end_date: e.target.value })
              }
              className="input-field"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setDateRange({})}
              className="btn-ghost text-sm"
            >
              Clear Dates
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards - Main Totals */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Expenses"
          value={formatCurrency(summary?.totals?.total_cad)}
          icon={<DollarSign className="w-5 h-5" />}
          color="yel"
          loading={isLoading}
        />
        <SummaryCard
          title="Verified Receipts"
          value={summary?.totals?.expense_count?.toString() || "0"}
          icon={<Receipt className="w-5 h-5" />}
          color="blue"
          loading={isLoading}
        />
        <SummaryCard
          title="ITC Recoverable (GST+HST)"
          value={formatCurrency(summary?.totals?.total_tax_recoverable)}
          icon={<TrendingUp className="w-5 h-5" />}
          color="green"
          loading={isLoading}
          subtitle="GST + HST Only"
        />
        <SummaryCard
          title="Meals (50%)"
          value={formatCurrency(summary?.totals?.meals_50_percent)}
          icon={<PieChart className="w-5 h-5" />}
          color="purple"
          loading={isLoading}
          subtitle="Deductible portion"
        />
      </div>

      {/* Tax Breakdown Cards */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Tax Breakdown (GST / HST / PST)
        </h2>
        <div className="grid sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-sm text-emerald-400 mb-1">GST (5%)</p>
            <p className="text-xl font-bold text-emerald-400">
              {formatCurrency(summary?.totals?.total_gst)}
            </p>
            <p className="text-xs text-emerald-500/70 mt-1">ITC Recoverable</p>
          </div>
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm text-blue-400 mb-1">HST (13-15%)</p>
            <p className="text-xl font-bold text-blue-400">
              {formatCurrency(summary?.totals?.total_hst)}
            </p>
            <p className="text-xs text-blue-500/70 mt-1">ITC Recoverable</p>
          </div>
          <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <p className="text-sm text-orange-400 mb-1">PST (6-10%)</p>
            <p className="text-xl font-bold text-orange-400">
              {formatCurrency(summary?.totals?.total_pst)}
            </p>
            <p className="text-xs text-orange-500/70 mt-1">NOT Recoverable</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-800/50">
            <p className="text-sm text-slate-400 mb-1">Total All Taxes</p>
            <p className="text-xl font-bold text-white">
              {formatCurrency(summary?.totals?.total_tax)}
            </p>
            <p className="text-xs text-slate-500 mt-1">GST + HST + PST</p>
          </div>
        </div>
      </div>

      {/* Category Breakdown with Separate Tax Columns */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Breakdown by Category
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : summary?.by_category ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-slate-400 border-b border-slate-800">
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium text-right">Count</th>
                  <th className="pb-3 font-medium text-right">Total CAD</th>
                  <th className="pb-3 font-medium text-right text-emerald-400">GST</th>
                  <th className="pb-3 font-medium text-right text-blue-400">HST</th>
                  <th className="pb-3 font-medium text-right text-orange-400">PST</th>
                  <th className="pb-3 font-medium text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {Object.entries(summary.by_category).map(
                  ([category, data]: [string, any]) => (
                    <tr key={category}>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor: categoryColors[category] || "#6B7280",
                            }}
                          />
                          <span className="text-white">
                            {categoryLabels[category] || category}
                          </span>
                          {category === "meals_entertainment" && (
                            <span className="text-xs text-orange-400">
                              (50% deductible)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right text-slate-300">
                        {data.count}
                      </td>
                      <td className="py-3 text-right text-white font-medium">
                        {formatCurrency(data.total_cad)}
                      </td>
                      <td className="py-3 text-right text-emerald-400">
                        {formatCurrency(data.total_gst)}
                      </td>
                      <td className="py-3 text-right text-blue-400">
                        {formatCurrency(data.total_hst)}
                      </td>
                      <td className="py-3 text-right text-orange-400">
                        {formatCurrency(data.total_pst)}
                      </td>
                      <td className="py-3 text-right text-slate-300">
                        {formatCurrency(data.total_tax)}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-700 font-semibold">
                  <td className="pt-4 text-white">Total</td>
                  <td className="pt-4 text-right text-white">
                    {summary.totals.expense_count}
                  </td>
                  <td className="pt-4 text-right text-yel-500">
                    {formatCurrency(summary.totals.total_cad)}
                  </td>
                  <td className="pt-4 text-right text-emerald-500">
                    {formatCurrency(summary.totals.total_gst)}
                  </td>
                  <td className="pt-4 text-right text-blue-500">
                    {formatCurrency(summary.totals.total_hst)}
                  </td>
                  <td className="pt-4 text-right text-orange-500">
                    {formatCurrency(summary.totals.total_pst)}
                  </td>
                  <td className="pt-4 text-right text-white">
                    {formatCurrency(summary.totals.total_tax)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-center py-8">
            No verified expenses to export
          </p>
        )}
      </div>

      {/* Payment Source Breakdown */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          By Payment Source
        </h2>
        {!isLoading && summary?.by_payment_source && (
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-800/50">
              <p className="text-sm text-slate-400 mb-1">Company Card</p>
              <p className="text-xl font-bold text-white">
                {formatCurrency(summary.by_payment_source.company_expenses)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <p className="text-sm text-orange-400 mb-1">Due to Shareholder</p>
              <p className="text-xl font-bold text-orange-400">
                {formatCurrency(summary.by_payment_source.due_to_shareholder)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/50">
              <p className="text-sm text-slate-400 mb-1">Unknown Card</p>
              <p className="text-xl font-bold text-white">
                {formatCurrency(summary.by_payment_source.unknown)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Export Buttons */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Download Report
        </h2>
        <p className="text-slate-400 mb-6">
          Export all verified expenses with full details including exchange rates,
          CAD amounts, and receipt links.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => handleExport("csv")}
            disabled={isExporting !== null}
            className="btn-secondary flex-1"
          >
            {isExporting === "csv" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <FileText className="w-5 h-5" />
            )}
            Download CSV
          </button>
          <button
            onClick={() => handleExport("xlsx")}
            disabled={isExporting !== null}
            className="btn-primary flex-1"
          >
            {isExporting === "xlsx" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-5 h-5" />
            )}
            Download Excel
          </button>
        </div>
      </div>

      {/* Export Info */}
      <div className="p-6 rounded-2xl bg-slate-800/30 border border-slate-800">
        <h3 className="font-semibold text-white mb-3">
          What's included in the export?
        </h3>
        <ul className="space-y-2 text-slate-400 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            Transaction date and vendor name
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            CRA-compliant expense category
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            Original currency and amount
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            Bank of Canada exchange rate used
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            CAD equivalent amount (most important for accounting)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-500">✓</span>
            <strong>GST (5%)</strong> - Federal tax, ITC recoverable
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500">✓</span>
            <strong>HST (13-15%)</strong> - Harmonized tax, ITC recoverable
          </li>
          <li className="flex items-start gap-2">
            <span className="text-orange-500">✓</span>
            <strong>PST (6-10%)</strong> - Provincial tax, NOT recoverable
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            Total tax amount (GST + HST + PST)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            Payment source (Company Card or Due to Shareholder)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-yel-500">✓</span>
            Direct links to receipt images
          </li>
        </ul>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  color,
  loading,
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: "yel" | "blue" | "green" | "purple";
  loading?: boolean;
  subtitle?: string;
}) {
  const colorClasses = {
    yel: "from-yel-500/20 to-yel-600/10 text-yel-500",
    blue: "from-blue-500/20 to-blue-600/10 text-blue-500",
    green: "from-emerald-500/20 to-emerald-600/10 text-emerald-500",
    purple: "from-purple-500/20 to-purple-600/10 text-purple-500",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 mb-1">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-slate-800 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-white">{value}</p>
          )}
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
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

