"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  DollarSign,
  Plus,
  Calendar,
  Building2,
  Truck,
  CheckCircle,
  Clock,
  Trash2,
  ExternalLink,
  X,
  Upload,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import toast from "react-hot-toast";
import { revenueApi, Revenue } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export default function RevenuePage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["revenues"],
    queryFn: () => revenueApi.list({ per_page: 100 }),
  });

  const { data: summary } = useQuery({
    queryKey: ["revenue-summary"],
    queryFn: () => revenueApi.getSummary(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => revenueApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["revenues"] });
      queryClient.invalidateQueries({ queryKey: ["revenue-summary"] });
      toast.success("Revenue entry deleted");
    },
    onError: () => {
      toast.error("Failed to delete revenue entry");
    },
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this revenue entry?")) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4 md:space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-white">Revenue</h1>
          <p className="text-slate-400 text-sm mt-0.5">Track your business income</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          <Plus className="w-5 h-5" />
          Add Revenue
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard
          title="Revenue (CAD)"
          value={formatCurrency(summary?.total_cad || 0)}
          icon={<TrendingUp className="w-5 h-5" />}
          color="green"
          loading={!summary}
        />
        <SummaryCard
          title="Revenue (USD)"
          value={formatCurrency(summary?.total_usd || 0, "USD")}
          icon={<DollarSign className="w-5 h-5" />}
          color="blue"
          loading={!summary}
        />
        <SummaryCard
          title="Verified Loads"
          value={summary?.verified_count?.toString() || "0"}
          icon={<CheckCircle className="w-5 h-5" />}
          color="purple"
          loading={!summary}
        />
      </div>

      {/* Revenue List */}
      <div className="card p-4 md:p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Income Entries</h2>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : data?.revenues && data.revenues.length > 0 ? (
          <div className="space-y-3">
            {data.revenues.map((revenue) => (
              <RevenueItem
                key={revenue.id}
                revenue={revenue}
                onDelete={() => handleDelete(revenue.id!)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <DollarSign className="w-12 h-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 mb-4">No revenue entries yet</p>
            <button onClick={() => setShowAddModal(true)} className="btn-primary">
              <Plus className="w-5 h-5" />
              Add Your First Income
            </button>
          </div>
        )}
      </div>

      {/* Add Revenue Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddRevenueModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              queryClient.invalidateQueries({ queryKey: ["revenues"] });
              queryClient.invalidateQueries({ queryKey: ["revenue-summary"] });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

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
  color: "green" | "blue" | "purple";
  loading?: boolean;
}) {
  const colorClasses = {
    green: "from-emerald-500/20 to-emerald-600/10 text-emerald-500",
    blue: "from-blue-500/20 to-blue-600/10 text-blue-500",
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

function RevenueItem({
  revenue,
  onDelete,
}: {
  revenue: Revenue;
  onDelete: () => void;
}) {
  // Handle both new multi-currency format and legacy format
  const originalAmount = revenue.amount_original || revenue.amount_usd || 0;
  const currency = revenue.currency || "USD";
  const showConversion = currency === "USD" && revenue.exchange_rate !== 1.0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 md:p-4 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors group"
    >
      {/* Desktop: horizontal layout */}
      <div className="hidden md:flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-white">{revenue.broker_name}</p>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium",
                currency === "CAD" ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
              )}>
                {currency}
              </span>
              {revenue.status === "verified" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-xs">
                  <CheckCircle className="w-3 h-3" />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-xs">
                  <Clock className="w-3 h-3" />
                  Pending
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {formatDate(revenue.date)}
              </span>
              {revenue.load_id && (
                <span className="flex items-center gap-1">
                  <Truck className="w-4 h-4" />
                  {revenue.load_id}
                </span>
              )}
              {showConversion && (
                <span className="flex items-center gap-1">
                  <RefreshCw className="w-4 h-4" />
                  {revenue.exchange_rate.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-lg font-bold text-emerald-500">
              {formatCurrency(revenue.amount_cad)}
            </p>
            {showConversion && (
              <p className="text-sm text-slate-500">
                {formatCurrency(originalAmount, "USD")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {revenue.image_url && (
              <a
                href={revenue.image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              onClick={onDelete}
              className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile: stacked layout */}
      <div className="md:hidden">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{revenue.broker_name}</p>
              <p className="text-xs text-slate-500">{formatDate(revenue.date)}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold text-emerald-500">
              {formatCurrency(revenue.amount_cad)}
            </p>
            {showConversion && (
              <p className="text-xs text-slate-500">
                {formatCurrency(originalAmount, "USD")}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "px-2 py-0.5 rounded-full text-xs font-medium",
              currency === "CAD" ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
            )}>
              {currency}
            </span>
            {revenue.status === "verified" ? (
              <CheckCircle className="w-4 h-4 text-emerald-500" />
            ) : (
              <Clock className="w-4 h-4 text-amber-500" />
            )}
            {revenue.load_id && (
              <span className="text-xs text-slate-500 flex items-center gap-0.5">
                <Truck className="w-3 h-3" />
                {revenue.load_id}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {revenue.image_url && (
              <a
                href={revenue.image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-slate-400 hover:text-white min-w-[32px] min-h-[32px] flex items-center justify-center"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              onClick={onDelete}
              className="p-1.5 text-slate-400 hover:text-red-500 min-w-[32px] min-h-[32px] flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AddRevenueModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    broker_name: "",
    load_id: "",
    date: new Date().toISOString().split("T")[0],
    amount: "",
    currency: "USD" as "USD" | "CAD",
    exchange_rate: "1.0",
    notes: "",
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
  };

  const handleProcessDocument = async () => {
    if (!file) {
      toast.error("Please upload a Rate Confirmation document");
      return;
    }

    setIsProcessing(true);
    console.log("📄 Starting Rate Confirmation processing...");
    console.log("📄 File:", file.name, file.type, file.size, "bytes");

    try {
      // Upload document
      toast.loading("Uploading document...", { id: "process" });
      console.log("📤 Uploading to Firebase Storage...");
      const imageUrl = await revenueApi.uploadDocument(file);
      console.log("✅ Upload successful:", imageUrl);
      setUploadedImageUrl(imageUrl);

      // Process with AI
      toast.loading("AI is reading the document...", { id: "process" });
      console.log("🤖 Sending to backend for OCR + AI processing...");
      const result = await revenueApi.processRateConfirmation(imageUrl);
      console.log("✅ AI processing result:", result);

      // Fetch exchange rate FIRST if USD - using the Rate Confirmation date
      let exchangeRate = "1.0";
      const parsedDate = result.date || new Date().toISOString().split("T")[0];

      if (result.currency === "USD" && result.date) {
        console.log(`💱 Currency: USD - Need to convert to CAD`);
        console.log(`💱 Rate Confirmation Date: ${result.date}`);
        console.log(`💱 Fetching Bank of Canada rate for this specific date...`);
        try {
          const rate = await revenueApi.fetchExchangeRate(new Date(result.date));
          exchangeRate = rate.toFixed(4);
          console.log(`💱 ✅ Exchange rate for ${result.date}: 1 USD = ${exchangeRate} CAD`);
        } catch (err) {
          console.error("💱 ❌ Failed to fetch exchange rate:", err);
          exchangeRate = "1.40"; // Fallback
        }
      } else {
        console.log("💱 Currency: CAD - No conversion needed (exchange rate = 1.0)");
      }

      // Update form with ALL parsed data including exchange rate in ONE call
      setFormData(prev => ({
        ...prev,
        broker_name: result.broker_name || "",
        load_id: result.load_id || "",
        date: parsedDate,
        amount: result.amount_original?.toString() || "",
        currency: result.currency || "USD",
        exchange_rate: exchangeRate,
      }));
      console.log("📝 Form updated with parsed data and exchange rate:", exchangeRate);

      toast.success("Document processed successfully!", { id: "process" });
      setStep("review");
    } catch (error: any) {
      console.error("❌ Error processing Rate Confirmation:", error);
      console.error("❌ Error details:", {
        message: error.message,
        stack: error.stack,
        response: error.response,
      });
      toast.error(error.message || "Failed to process document", { id: "process" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setFormData({ ...formData, date: newDate });

    // Only fetch rate if currency is USD
    if (formData.currency === "USD") {
      setIsFetchingRate(true);
      try {
        const rate = await revenueApi.fetchExchangeRate(new Date(newDate));
        setFormData(prev => ({ ...prev, exchange_rate: rate.toFixed(4) }));
      } catch (error) {
        console.error("Failed to fetch rate:", error);
      } finally {
        setIsFetchingRate(false);
      }
    }
  };

  const handleCurrencyChange = async (newCurrency: "USD" | "CAD") => {
    setFormData(prev => ({ ...prev, currency: newCurrency }));

    if (newCurrency === "CAD") {
      setFormData(prev => ({ ...prev, exchange_rate: "1.0" }));
    } else if (formData.date) {
      setIsFetchingRate(true);
      try {
        const rate = await revenueApi.fetchExchangeRate(new Date(formData.date));
        setFormData(prev => ({ ...prev, exchange_rate: rate.toFixed(4) }));
      } catch (error) {
        console.error("Failed to fetch rate:", error);
      } finally {
        setIsFetchingRate(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.broker_name || !formData.amount) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const amountOriginal = parseFloat(formData.amount);
      const exchangeRate = parseFloat(formData.exchange_rate);
      const amountCad = formData.currency === "CAD"
        ? amountOriginal
        : amountOriginal * exchangeRate;

      console.log("💾 SAVING REVENUE:");
      console.log("💾 Form Data:", formData);
      console.log("💾 Exchange Rate from form:", formData.exchange_rate);
      console.log("💾 Parsed Exchange Rate:", exchangeRate);
      console.log("💾 Amount Original:", amountOriginal);
      console.log("💾 Amount CAD:", amountCad);

      const revenueData = {
        broker_name: formData.broker_name,
        load_id: formData.load_id || null,
        date: new Date(formData.date),
        amount_original: amountOriginal,
        currency: formData.currency,
        exchange_rate: exchangeRate,
        amount_cad: Math.round(amountCad * 100) / 100,
        image_url: uploadedImageUrl,
        status: "verified" as const,
        notes: formData.notes || null,
      };

      console.log("💾 Revenue data to save:", revenueData);

      await revenueApi.create(revenueData);

      toast.success("Revenue entry added!");
      onSuccess();
    } catch (error: any) {
      console.error("💾 ❌ Failed to save revenue:", error);
      toast.error(error.message || "Failed to add revenue");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualEntry = () => {
    setStep("review");
  };

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
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-white">Add Revenue</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {step === "upload" ? "Upload Rate Confirmation" : "Review & Confirm"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === "upload" ? (
          /* Upload Step */
          <div className="p-6 space-y-5">
            {/* Document Upload */}
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Rate Confirmation Document
              </label>
              <div
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
                  previewUrl
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-slate-700 hover:border-amber-500/50"
                )}
                onClick={() => document.getElementById("doc-upload")?.click()}
              >
                <input
                  id="doc-upload"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {previewUrl ? (
                  <div className="space-y-2">
                    <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
                    <p className="text-emerald-500 font-medium">{file?.name}</p>
                    <p className="text-xs text-slate-500">Click to change</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Upload className="w-10 h-10 text-slate-500 mx-auto" />
                    <div>
                      <p className="text-white font-medium">Upload Rate Confirmation</p>
                      <p className="text-sm text-slate-500">RXO, C.H. Robinson, TQL, etc.</p>
                    </div>
                    <p className="text-xs text-slate-500">PNG, JPG, or PDF</p>
                  </div>
                )}
              </div>
            </div>

            {/* AI Info */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400">
                <strong>AI-Powered:</strong> Our system will automatically extract broker name,
                load ID, amount, and detect currency (USD vs CAD).
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleManualEntry}
                className="btn-ghost flex-1"
                disabled={isProcessing}
              >
                Manual Entry
              </button>
              <button
                type="button"
                onClick={handleProcessDocument}
                className="btn-primary flex-1"
                disabled={isProcessing || !file}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-5 h-5" />
                    Process with AI
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Review Step */
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Broker Name */}
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Broker / Company Name *
              </label>
              <input
                type="text"
                value={formData.broker_name}
                onChange={(e) => setFormData({ ...formData, broker_name: e.target.value })}
                placeholder="e.g., RXO, C.H. Robinson"
                className="input-field"
                required
              />
            </div>

            {/* Load ID */}
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Load ID (Optional)
              </label>
              <input
                type="text"
                value={formData.load_id}
                onChange={(e) => setFormData({ ...formData, load_id: e.target.value })}
                placeholder="e.g., RC-12345"
                className="input-field"
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Transaction Date *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={handleDateChange}
                className="input-field"
                required
              />
            </div>

            {/* Amount & Currency */}
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Amount *
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                    {formData.currency === "CAD" ? "C$" : "$"}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                    className="input-field pl-10"
                    required
                  />
                </div>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange("USD")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors",
                      formData.currency === "USD"
                        ? "bg-blue-500 text-white"
                        : "bg-slate-800 text-slate-400 hover:text-white"
                    )}
                  >
                    USD
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange("CAD")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors",
                      formData.currency === "CAD"
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-800 text-slate-400 hover:text-white"
                    )}
                  >
                    CAD
                  </button>
                </div>
              </div>
            </div>

            {/* Exchange Rate (only for USD) */}
            {formData.currency === "USD" && (
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block flex items-center gap-2">
                  Exchange Rate (Bank of Canada)
                  {isFetchingRate && <Loader2 className="w-4 h-4 animate-spin" />}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.exchange_rate}
                    onChange={(e) => setFormData({ ...formData, exchange_rate: e.target.value })}
                    className="input-field w-32"
                  />
                  <span className="text-slate-400">=</span>
                  <span className="text-lg font-bold text-emerald-500">
                    {formatCurrency(
                      parseFloat(formData.amount || "0") * parseFloat(formData.exchange_rate || "1")
                    )} CAD
                  </span>
                </div>
              </div>
            )}

            {/* CAD Summary */}
            {formData.currency === "CAD" && formData.amount && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-sm text-emerald-400">
                  No conversion needed - CAD amount will be saved as: <strong>{formatCurrency(parseFloat(formData.amount))}</strong>
                </p>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">
                Notes (Optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any additional notes..."
                className="input-field min-h-[60px] resize-none"
                rows={2}
              />
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep("upload")}
                className="btn-ghost flex-1"
                disabled={isSubmitting}
              >
                Back
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
                    Add Revenue
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

