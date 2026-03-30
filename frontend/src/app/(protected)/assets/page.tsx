"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package,
  Plus,
  Truck,
  Car,
  Monitor,
  Building2,
  Wrench,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  DollarSign,
  Calendar,
  AlertTriangle,
  CheckCircle,
  X,
  Loader2,
  Trash2,
  Edit3,
  ArrowRight,
  BarChart3,
  Zap,
  RefreshCw,
  Info,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  assetsApi,
  CCAAsset,
  CCAAssetCategory,
  expensesApi,
} from "@/lib/firebase-api";
import {
  CCA_CLASSES,
  formatCCAClassName,
  formatCCARate,
  formatAssetCategory,
  generateUCCSchedule,
  getAdjustedCost,
  UCCScheduleEntry,
} from "@/lib/cca-engine";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { assetCategoryColors } from "@/lib/store";

const CURRENT_YEAR = new Date().getFullYear();

const categoryIcons: Record<string, React.ReactNode> = {
  vehicle: <Car className="w-5 h-5" />,
  trailer: <Truck className="w-5 h-5" />,
  equipment: <Wrench className="w-5 h-5" />,
  computer: <Monitor className="w-5 h-5" />,
  building: <Building2 className="w-5 h-5" />,
  furniture: <Package className="w-5 h-5" />,
  other: <HelpCircle className="w-5 h-5" />,
};

export default function AssetsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<CCAAsset | null>(null);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);

  const { data: assets, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => assetsApi.list(),
  });

  const { data: ccaReport } = useQuery({
    queryKey: ["cca-report", selectedYear],
    queryFn: () => assetsApi.getCCAReport(selectedYear),
  });

  const { data: assetCandidates, isLoading: isScanningCandidates } = useQuery({
    queryKey: ["asset-candidates"],
    queryFn: () => assetsApi.scanForAssetCandidates(),
    staleTime: 60000,
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this asset? This cannot be undone.")) return;
    try {
      await assetsApi.delete(id);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["cca-report"] });
      toast.success("Asset deleted");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete asset");
    }
  };

  const activeAssets = useMemo(
    () => (assets || []).filter((a) => a.status === "active"),
    [assets],
  );

  return (
    <div className="space-y-4 md:space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-white">
            Assets & CCA
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Capital Cost Allowance — CRA compliant depreciation tracking
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConvertModal(true)}
            className="btn-secondary text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Convert Expense
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary text-sm"
          >
            <Plus className="w-5 h-5" />
            Add Asset
          </button>
        </div>
      </div>

      {/* Asset Candidate Alert */}
      {assetCandidates && assetCandidates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-amber-400">
                {assetCandidates.length} Potential Asset{assetCandidates.length > 1 ? "s" : ""} Detected
              </h3>
              <p className="text-xs text-amber-500/80 mt-0.5">
                High-value expenses that may need to be reclassified as depreciable assets for CRA compliance.
              </p>
              <div className="mt-3 space-y-2">
                {assetCandidates.slice(0, 3).map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/5 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="text-white font-medium">
                        {c.expense.vendor_name || "Unknown"}
                      </span>
                      <span className="text-slate-400 ml-2">
                        {formatCurrency(c.expense.cad_amount || 0)}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setShowConvertModal(true);
                      }}
                      className="text-amber-400 hover:text-amber-300 font-medium whitespace-nowrap"
                    >
                      Convert →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Year Selector + Summary Cards */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-slate-400">Fiscal Year:</label>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="text-sm rounded-lg px-3 py-1.5 border border-slate-700 bg-slate-800/50 text-white"
        >
          {[2024, 2025, 2026, 2027, 2028].map((yr) => (
            <option key={yr} value={yr}>
              {yr}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          title="Total Asset Value"
          value={formatCurrency(ccaReport?.totalAssetValue || 0)}
          icon={<DollarSign className="w-5 h-5" />}
          color="blue"
          loading={!ccaReport && isLoading}
        />
        <SummaryCard
          title={`CCA Deduction (${selectedYear})`}
          value={formatCurrency(ccaReport?.totalCCA || 0)}
          icon={<TrendingDown className="w-5 h-5" />}
          color="green"
          loading={!ccaReport && isLoading}
        />
        <SummaryCard
          title={`UCC Balance (${selectedYear})`}
          value={formatCurrency(ccaReport?.totalUCC || 0)}
          icon={<BarChart3 className="w-5 h-5" />}
          color="purple"
          loading={!ccaReport && isLoading}
        />
        <SummaryCard
          title="Active Assets"
          value={String(activeAssets.length)}
          icon={<Package className="w-5 h-5" />}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* CCA Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-400">
          <p className="text-blue-400 font-medium mb-1">CRA Half-Year Rule</p>
          <p>
            In the year an asset is acquired, only 50% of the normal CCA rate
            is allowed. This is automatically applied by the system.
          </p>
        </div>
      </div>

      {/* Assets List */}
      <div className="card">
        <div className="px-5 py-4 border-b border-slate-800/50">
          <h2 className="text-lg font-semibold text-white">
            Registered Assets
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-amber-500 border-r-transparent" />
          </div>
        ) : activeAssets.length > 0 ? (
          <div className="divide-y divide-slate-800/50">
            {(ccaReport?.assets || activeAssets).map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                ccaForYear={"ccaForYear" in asset ? (asset as any).ccaForYear : 0}
                uccBalance={"uccBalance" in asset ? (asset as any).uccBalance : asset.adjusted_cost}
                selectedYear={selectedYear}
                onEdit={() => setSelectedAsset(asset)}
                onDelete={() => asset.id && handleDelete(asset.id)}
              />
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
              <Package className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              No assets registered
            </h3>
            <p className="text-slate-400 mb-4 text-sm">
              Add your first depreciable asset to start tracking CCA deductions.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary"
            >
              <Plus className="w-5 h-5" />
              Add Asset
            </button>
          </div>
        )}
      </div>

      {/* CCA Schedule Table */}
      {activeAssets.length > 0 && (
        <CCAScheduleTable assets={activeAssets} selectedYear={selectedYear} />
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAddModal && (
          <AddAssetModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              queryClient.invalidateQueries({ queryKey: ["assets"] });
              queryClient.invalidateQueries({ queryKey: ["cca-report"] });
            }}
          />
        )}
        {showConvertModal && (
          <ConvertExpenseModal
            onClose={() => setShowConvertModal(false)}
            onSuccess={() => {
              setShowConvertModal(false);
              queryClient.invalidateQueries({ queryKey: ["assets"] });
              queryClient.invalidateQueries({ queryKey: ["cca-report"] });
              queryClient.invalidateQueries({ queryKey: ["asset-candidates"] });
              queryClient.invalidateQueries({ queryKey: ["expenses"] });
            }}
            candidates={assetCandidates || []}
          />
        )}
        {selectedAsset && (
          <AssetDetailModal
            asset={selectedAsset}
            onClose={() => setSelectedAsset(null)}
            onSave={() => {
              setSelectedAsset(null);
              queryClient.invalidateQueries({ queryKey: ["assets"] });
              queryClient.invalidateQueries({ queryKey: ["cca-report"] });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ COMPONENTS ============

function SummaryCard({
  title,
  value,
  icon,
  color,
  loading,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: "blue" | "green" | "purple" | "amber";
  loading?: boolean;
}) {
  const colorClasses = {
    blue: "from-blue-500/20 to-blue-600/10 text-blue-500",
    green: "from-emerald-500/20 to-emerald-600/10 text-emerald-500",
    purple: "from-purple-500/20 to-purple-600/10 text-purple-500",
    amber: "from-amber-500/20 to-amber-600/10 text-amber-500",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-4 md:p-5"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-400 mb-1">{title}</p>
          {loading ? (
            <div className="h-7 w-24 bg-slate-800 rounded animate-pulse" />
          ) : (
            <p className="text-lg md:text-xl font-bold text-white">{value}</p>
          )}
        </div>
        <div
          className={cn(
            "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center",
            colorClasses[color],
          )}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

function AssetRow({
  asset,
  ccaForYear,
  uccBalance,
  selectedYear,
  onEdit,
  onDelete,
}: {
  asset: CCAAsset;
  ccaForYear: number;
  uccBalance: number;
  selectedYear: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ccaClass = CCA_CLASSES[asset.cca_class];
  const color = assetCategoryColors[asset.category] || "#6B7280";

  const purchaseDate =
    asset.purchase_date instanceof Date
      ? asset.purchase_date
      : new Date(asset.purchase_date);
  const purchaseYear = purchaseDate.getFullYear();
  const isAcquisitionYear = purchaseYear === selectedYear;

  return (
    <div className="group">
      {/* Main Row */}
      <div
        className="flex items-center gap-4 px-5 py-4 hover:bg-slate-800/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {categoryIcons[asset.category] || <Package className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">
              {asset.name}
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {formatCCAClassName(asset.cca_class)} ({formatCCARate(asset.cca_class)})
            </span>
            {isAcquisitionYear && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400">
                Half-Year Rule
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {asset.vendor_name} • Purchased {formatDate(asset.purchase_date)}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-6 text-right flex-shrink-0">
          <div>
            <p className="text-xs text-slate-500">Cost</p>
            <p className="text-sm font-semibold text-white">
              {formatCurrency(asset.purchase_cost)}
            </p>
            {asset.adjusted_cost !== asset.purchase_cost && (
              <p className="text-[10px] text-amber-400">
                Adjusted: {formatCurrency(asset.adjusted_cost)}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">CCA ({selectedYear})</p>
            <p className="text-sm font-semibold text-emerald-400">
              {formatCurrency(ccaForYear)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">UCC</p>
            <p className="text-sm font-semibold text-purple-400">
              {formatCurrency(uccBalance)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </div>

      {/* Mobile Summary (shown below row on mobile) */}
      <div className="md:hidden px-5 pb-3 flex gap-4 text-xs">
        <div>
          <span className="text-slate-500">Cost: </span>
          <span className="text-white font-medium">{formatCurrency(asset.purchase_cost)}</span>
        </div>
        <div>
          <span className="text-slate-500">CCA: </span>
          <span className="text-emerald-400 font-medium">{formatCurrency(ccaForYear)}</span>
        </div>
        <div>
          <span className="text-slate-500">UCC: </span>
          <span className="text-purple-400 font-medium">{formatCurrency(uccBalance)}</span>
        </div>
      </div>

      {/* Expanded UCC Schedule */}
      <AnimatePresence>
        {expanded && asset.ucc_schedule && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800/50">
                      <th className="px-3 py-2 text-left text-slate-400 font-medium">Year</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-medium">Opening UCC</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-medium">Additions</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-medium">Rate</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-medium">CCA</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-medium">Closing UCC</th>
                      <th className="px-3 py-2 text-center text-slate-400 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {asset.ucc_schedule.slice(0, 10).map((entry) => (
                      <tr
                        key={entry.year}
                        className={cn(
                          "transition-colors",
                          entry.year === selectedYear
                            ? "bg-amber-500/5"
                            : "hover:bg-slate-800/20",
                        )}
                      >
                        <td className="px-3 py-2 text-white font-medium">
                          {entry.year}
                          {entry.year === selectedYear && (
                            <span className="ml-1 text-amber-400">←</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {formatCurrency(entry.openingUCC)}
                        </td>
                        <td className="px-3 py-2 text-right text-blue-400">
                          {entry.additions > 0 ? formatCurrency(entry.additions) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">
                          {entry.halfYearApplied
                            ? `${((entry.ccaRate * 100) / 2).toFixed(0)}%*`
                            : `${(entry.ccaRate * 100).toFixed(0)}%`}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-400 font-medium">
                          {formatCurrency(entry.ccaAmount)}
                        </td>
                        <td className="px-3 py-2 text-right text-purple-400">
                          {formatCurrency(entry.closingUCC)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {entry.halfYearApplied && (
                            <span className="text-amber-400 text-[10px]">
                              Half-year
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                * Half-year rule applied — CCA calculated at 50% of the normal rate in the year of acquisition.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CCAScheduleTable({
  assets,
  selectedYear,
}: {
  assets: CCAAsset[];
  selectedYear: number;
}) {
  const years = [selectedYear - 1, selectedYear, selectedYear + 1, selectedYear + 2];

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/50">
        <h2 className="text-lg font-semibold text-white">
          CCA Schedule Summary
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Year-by-year CCA deductions across all assets
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/50">
              <th className="px-5 py-3 text-left text-slate-400 font-medium">
                Asset
              </th>
              <th className="px-5 py-3 text-left text-slate-400 font-medium">
                Class
              </th>
              <th className="px-5 py-3 text-right text-slate-400 font-medium">
                Cost
              </th>
              {years.map((yr) => (
                <th
                  key={yr}
                  className={cn(
                    "px-5 py-3 text-right font-medium",
                    yr === selectedYear ? "text-amber-400" : "text-slate-400",
                  )}
                >
                  {yr}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {assets.map((asset) => {
              const schedule = asset.ucc_schedule || [];
              return (
                <tr
                  key={asset.id}
                  className="hover:bg-slate-800/20 transition-colors"
                >
                  <td className="px-5 py-3 text-white font-medium">
                    {asset.name}
                  </td>
                  <td className="px-5 py-3 text-slate-400">
                    {formatCCAClassName(asset.cca_class)}
                  </td>
                  <td className="px-5 py-3 text-right text-white">
                    {formatCurrency(asset.adjusted_cost)}
                  </td>
                  {years.map((yr) => {
                    const entry = schedule.find(
                      (e: UCCScheduleEntry) => e.year === yr,
                    );
                    return (
                      <td
                        key={yr}
                        className={cn(
                          "px-5 py-3 text-right",
                          yr === selectedYear
                            ? "text-emerald-400 font-medium"
                            : "text-slate-300",
                        )}
                      >
                        {entry ? formatCurrency(entry.ccaAmount) : "—"}
                        {entry?.halfYearApplied && (
                          <span className="text-amber-400 text-[10px] ml-1">
                            *
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Totals Row */}
            <tr className="bg-slate-800/30 font-semibold">
              <td className="px-5 py-3 text-white" colSpan={3}>
                Total CCA Deduction
              </td>
              {years.map((yr) => {
                const total = assets.reduce((sum, asset) => {
                  const entry = (asset.ucc_schedule || []).find(
                    (e: UCCScheduleEntry) => e.year === yr,
                  );
                  return sum + (entry?.ccaAmount || 0);
                }, 0);
                return (
                  <td
                    key={yr}
                    className={cn(
                      "px-5 py-3 text-right",
                      yr === selectedYear
                        ? "text-emerald-400"
                        : "text-white",
                    )}
                  >
                    {formatCurrency(total)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ MODALS ============

function AddAssetModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    cca_class: "class_10",
    purchase_date: new Date().toISOString().split("T")[0],
    purchase_cost: "",
    vendor_name: "",
    category: "equipment" as CCAAssetCategory,
    notes: "",
  });

  const selectedClass = CCA_CLASSES[formData.cca_class];
  const cost = parseFloat(formData.purchase_cost) || 0;
  const adjustedCost = getAdjustedCost(cost, formData.cca_class);
  const hasCeiling = adjustedCost < cost;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.purchase_cost) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      await assetsApi.create({
        name: formData.name,
        description: formData.description,
        cca_class: formData.cca_class,
        purchase_date: new Date(formData.purchase_date),
        purchase_cost: cost,
        vendor_name: formData.vendor_name,
        category: formData.category,
        status: "active",
        notes: formData.notes,
      });
      toast.success("Asset registered successfully!");
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || "Failed to add asset");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalWrapper onClose={onClose} title="Add New Asset" subtitle="Register a depreciable capital asset">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Asset Name */}
        <FormField label="Asset Name *">
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., 2025 Dry Van Trailer"
            className="input-field"
            required
          />
        </FormField>

        {/* Category + CCA Class */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Category">
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as CCAAssetCategory })}
              className="input-field"
            >
              <option value="vehicle">Vehicle</option>
              <option value="trailer">Trailer</option>
              <option value="equipment">Equipment</option>
              <option value="furniture">Furniture & Fixtures</option>
              <option value="computer">Computer Hardware</option>
              <option value="building">Building</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="CCA Class *">
            <select
              value={formData.cca_class}
              onChange={(e) => setFormData({ ...formData, cca_class: e.target.value })}
              className="input-field"
            >
              {Object.entries(CCA_CLASSES).map(([id, cls]) => (
                <option key={id} value={id}>
                  {formatCCAClassName(id)} — {(cls.rate * 100).toFixed(0)}% — {cls.description}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* CCA Class Info */}
        {selectedClass && (
          <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs">
            <p className="text-blue-400 font-medium mb-1">
              {formatCCAClassName(formData.cca_class)}: {selectedClass.description}
            </p>
            <p className="text-slate-400">
              Rate: {(selectedClass.rate * 100).toFixed(0)}% declining balance
              {selectedClass.costCeiling &&
                ` • Max depreciable: ${formatCurrency(selectedClass.costCeiling)}`}
            </p>
          </div>
        )}

        {/* Purchase Date + Cost */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Purchase Date *">
            <input
              type="date"
              value={formData.purchase_date}
              onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
              className="input-field"
              required
            />
          </FormField>
          <FormField label="Purchase Cost (CAD) *">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium">CAD</span>
              <input
                type="number"
                step="0.01"
                value={formData.purchase_cost}
                onChange={(e) => setFormData({ ...formData, purchase_cost: e.target.value })}
                placeholder="0.00"
                className="input-field pl-14"
                required
              />
            </div>
          </FormField>
        </div>

        {/* Cost Ceiling Warning */}
        {hasCeiling && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
            <p className="text-amber-400 font-medium mb-1">⚠️ Class 10.1 Cost Ceiling Applied</p>
            <p className="text-slate-400">
              Actual cost: {formatCurrency(cost)} → Depreciable amount capped at{" "}
              {formatCurrency(adjustedCost)} per CRA rules.
            </p>
          </div>
        )}

        {/* Vendor */}
        <FormField label="Vendor / Seller">
          <input
            type="text"
            value={formData.vendor_name}
            onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
            placeholder="e.g., Honda Dealership"
            className="input-field"
          />
        </FormField>

        {/* Notes */}
        <FormField label="Notes">
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="VIN, serial number, or other details..."
            className="input-field min-h-[60px] resize-none"
          />
        </FormField>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Plus className="w-5 h-5" />
                Register Asset
              </>
            )}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ConvertExpenseModal({
  onClose,
  onSuccess,
  candidates,
}: {
  onClose: () => void;
  onSuccess: () => void;
  candidates: Array<{
    expense: any;
    reason: string;
    suggestedClasses: string[];
    suggestedCategory: CCAAssetCategory;
  }>;
}) {
  const [isConverting, setIsConverting] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(
    candidates.length > 0 ? 0 : null,
  );
  const [assetName, setAssetName] = useState("");
  const [ccaClass, setCcaClass] = useState("class_10");
  const [category, setCategory] = useState<CCAAssetCategory>("equipment");

  const candidate = selectedCandidate !== null ? candidates[selectedCandidate] : null;

  // Auto-fill when candidate changes
  React.useEffect(() => {
    if (candidate) {
      setAssetName(
        candidate.expense.vendor_name
          ? `${new Date(candidate.expense.transaction_date).getFullYear()} ${candidate.expense.vendor_name}`
          : "",
      );
      setCcaClass(candidate.suggestedClasses[0] || "class_10");
      setCategory(candidate.suggestedCategory);
    }
  }, [selectedCandidate, candidate]);

  const handleConvert = async () => {
    if (!candidate || !assetName) {
      toast.error("Please provide an asset name");
      return;
    }

    setIsConverting(true);
    try {
      await assetsApi.convertFromExpense(
        candidate.expense.id!,
        ccaClass,
        assetName,
        category,
      );
      toast.success("Expense converted to asset successfully!");
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || "Conversion failed");
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <ModalWrapper
      onClose={onClose}
      title="Convert Expense to Asset"
      subtitle="Reclassify an expense as a depreciable capital asset"
    >
      {candidates.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <p className="text-slate-400">
            No asset candidates found. All high-value expenses have been properly classified.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Candidate List */}
          <FormField label="Select Expense to Convert">
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedCandidate(i)}
                  className={cn(
                    "w-full text-left p-3 rounded-xl border transition-all",
                    selectedCandidate === i
                      ? "border-amber-500/50 bg-amber-500/5"
                      : "border-slate-700 bg-slate-800/50 hover:border-slate-600",
                  )}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {c.expense.vendor_name || "Unknown"}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(c.expense.transaction_date)} • {c.reason}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-white">
                      {formatCurrency(c.expense.cad_amount || 0)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </FormField>

          {candidate && (
            <>
              {/* Asset Name */}
              <FormField label="Asset Name *">
                <input
                  type="text"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="e.g., 2025 Honda CR-V"
                  className="input-field"
                />
              </FormField>

              {/* CCA Class + Category */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Category">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CCAAssetCategory)}
                    className="input-field"
                  >
                    <option value="vehicle">Vehicle</option>
                    <option value="trailer">Trailer</option>
                    <option value="equipment">Equipment</option>
                    <option value="furniture">Furniture & Fixtures</option>
                    <option value="computer">Computer Hardware</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
                <FormField label="CCA Class">
                  <select
                    value={ccaClass}
                    onChange={(e) => setCcaClass(e.target.value)}
                    className="input-field"
                  >
                    {Object.entries(CCA_CLASSES).map(([id, cls]) => (
                      <option key={id} value={id}>
                        {formatCCAClassName(id)} — {(cls.rate * 100).toFixed(0)}%
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              {/* Conversion Info */}
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-slate-400">
                <p className="text-blue-400 font-medium mb-1">What happens:</p>
                <ul className="space-y-1">
                  <li>• A new asset record will be created with CCA tracking</li>
                  <li>• The original expense will be marked as "[RECLASSIFIED TO ASSET]"</li>
                  <li>• CCA deductions will be calculated automatically</li>
                </ul>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="btn-ghost flex-1">
                  Cancel
                </button>
                <button
                  onClick={handleConvert}
                  className="btn-primary flex-1"
                  disabled={isConverting || !assetName}
                >
                  {isConverting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Converting...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-5 h-5" />
                      Convert to Asset
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </ModalWrapper>
  );
}

function AssetDetailModal({
  asset,
  onClose,
  onSave,
}: {
  asset: CCAAsset;
  onClose: () => void;
  onSave: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: asset.name,
    description: asset.description || "",
    cca_class: asset.cca_class,
    category: asset.category,
    notes: asset.notes || "",
  });

  const handleSave = async () => {
    if (!asset.id) return;
    setIsSubmitting(true);
    try {
      await assetsApi.update(asset.id, {
        name: formData.name,
        description: formData.description,
        cca_class: formData.cca_class,
        category: formData.category as CCAAssetCategory,
        notes: formData.notes,
      });
      toast.success("Asset updated");
      onSave();
    } catch (error: any) {
      toast.error(error.message || "Update failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalWrapper onClose={onClose} title="Edit Asset" subtitle={asset.name}>
      <div className="space-y-4">
        <FormField label="Asset Name">
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="input-field"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Category">
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as CCAAssetCategory })}
              className="input-field"
            >
              <option value="vehicle">Vehicle</option>
              <option value="trailer">Trailer</option>
              <option value="equipment">Equipment</option>
              <option value="furniture">Furniture & Fixtures</option>
              <option value="computer">Computer Hardware</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="CCA Class">
            <select
              value={formData.cca_class}
              onChange={(e) => setFormData({ ...formData, cca_class: e.target.value })}
              className="input-field"
            >
              {Object.entries(CCA_CLASSES).map(([id, cls]) => (
                <option key={id} value={id}>
                  {formatCCAClassName(id)} — {(cls.rate * 100).toFixed(0)}%
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Read-only Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-slate-800/50">
            <p className="text-xs text-slate-500">Purchase Cost</p>
            <p className="text-lg font-bold text-white">{formatCurrency(asset.purchase_cost)}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-800/50">
            <p className="text-xs text-slate-500">Adjusted Cost</p>
            <p className="text-lg font-bold text-white">{formatCurrency(asset.adjusted_cost)}</p>
          </div>
        </div>

        <FormField label="Notes">
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="input-field min-h-[60px] resize-none"
          />
        </FormField>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-primary flex-1"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}

// ============ SHARED HELPERS ============

function ModalWrapper({
  children,
  onClose,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {subtitle && (
              <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm text-slate-400 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
