"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Check,
  Loader2,
  Calendar,
  DollarSign,
  Tag,
  Building,
  CreditCard,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { expensesApi } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels } from "@/lib/store";

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: any;
  onSave: () => void;
}

export function ReviewModal({
  isOpen,
  onClose,
  expense,
  onSave,
}: ReviewModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, watch, setValue } = useForm({
    defaultValues: {
      vendor_name: expense.vendor_name || "",
      transaction_date: expense.transaction_date
        ? new Date(expense.transaction_date).toISOString().split("T")[0]
        : "",
      category: expense.category || "uncategorized",
      original_amount: expense.original_amount || 0,
      gst_amount: expense.gst_amount || 0,
      hst_amount: expense.hst_amount || 0,
      pst_amount: expense.pst_amount || 0,
      notes: expense.notes || "",
    },
  });

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      await expensesApi.update(expense.id, {
        ...data,
        transaction_date: new Date(data.transaction_date).toISOString(),
        is_verified: true,
      });
      onSave();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to save expense");
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyWithoutChanges = async () => {
    setIsSubmitting(true);
    try {
      await expensesApi.verify(expense.id);
      onSave();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to verify expense");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl"
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-6 bg-slate-900 border-b border-slate-800">
            <div>
              <h2 className="text-xl font-display font-bold text-white">
                Review Expense
              </h2>
              <p className="text-sm text-slate-400">
                Verify the extracted data before saving
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Receipt Preview */}
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-3">
                  Receipt Image
                </h3>
                {expense.receipt_image_url ? (
                  <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800">
                    <img
                      src={expense.receipt_image_url}
                      alt="Receipt"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="aspect-[3/4] rounded-xl bg-slate-800 flex items-center justify-center text-slate-500">
                    No image available
                  </div>
                )}

                {/* Jurisdiction & Currency Info */}
                <div className="mt-4 p-4 rounded-xl bg-slate-800/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-300">
                      {expense.jurisdiction === "usa"
                        ? "🇺🇸 United States"
                        : expense.jurisdiction === "canada"
                        ? "🇨🇦 Canada"
                        : "Unknown Location"}
                    </span>
                  </div>
                  {expense.original_currency === "USD" && (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-300">
                        Rate: 1 USD = {expense.exchange_rate?.toFixed(4)} CAD
                      </span>
                    </div>
                  )}
                  {expense.card_last_4 && (
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-300">
                        Card ending in {expense.card_last_4}
                        {expense.payment_source === "personal_card" && (
                          <span className="ml-2 text-xs text-orange-400">
                            (Due to Shareholder)
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Edit Form */}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                {/* Vendor Name */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                    <Building className="w-4 h-4" />
                    Vendor Name
                  </label>
                  <input
                    type="text"
                    {...register("vendor_name")}
                    className="input-field"
                    placeholder="Enter vendor name"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                    <Calendar className="w-4 h-4" />
                    Transaction Date
                  </label>
                  <input
                    type="date"
                    {...register("transaction_date")}
                    className="input-field"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                    <Tag className="w-4 h-4" />
                    Category
                  </label>
                  <select {...register("category")} className="input-field">
                    {Object.entries(categoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {watch("category") === "meals_entertainment" && (
                    <p className="text-xs text-orange-400 mt-1">
                      ⚠️ Only 50% of this expense is tax deductible
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                    <DollarSign className="w-4 h-4" />
                    Amount ({expense.original_currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    {...register("original_amount", { valueAsNumber: true })}
                    className="input-field"
                  />
                  {expense.original_currency === "USD" && (
                    <p className="text-sm text-slate-500 mt-1">
                      = {formatCurrency(watch("original_amount") * expense.exchange_rate)} CAD
                    </p>
                  )}
                </div>

                {/* Tax Amounts (Only for Canada) - Separate fields for GST, HST, PST */}
                {expense.jurisdiction === "canada" && (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                      <p className="text-xs text-slate-400 mb-3">
                        💡 Enter tax types separately. HST = combined GST+PST for provinces (ON, NB, NS, NL, PE)
                      </p>
                      
                      {/* GST */}
                      <div className="mb-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-1">
                          GST (5%) - Federal Tax
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          {...register("gst_amount", { valueAsNumber: true })}
                          className="input-field"
                          placeholder="0.00"
                        />
                        <p className="text-xs text-emerald-500 mt-0.5">Recoverable via ITC</p>
                      </div>
                      
                      {/* HST */}
                      <div className="mb-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-1">
                          HST (13-15%) - Harmonized Tax
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          {...register("hst_amount", { valueAsNumber: true })}
                          className="input-field"
                          placeholder="0.00"
                        />
                        <p className="text-xs text-emerald-500 mt-0.5">Recoverable via ITC (ON, NB, NS, NL, PE)</p>
                      </div>
                      
                      {/* PST */}
                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-1">
                          PST/QST (6-10%) - Provincial Tax
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          {...register("pst_amount", { valueAsNumber: true })}
                          className="input-field"
                          placeholder="0.00"
                        />
                        <p className="text-xs text-orange-400 mt-0.5">Not recoverable (BC, MB, SK, QC)</p>
                      </div>
                    </div>
                    
                    {/* Total Tax Display */}
                    <div className="flex justify-between items-center p-2 rounded bg-slate-800/30">
                      <span className="text-sm text-slate-400">Total Tax:</span>
                      <span className="text-sm font-semibold text-white">
                        ${((watch("gst_amount") || 0) + (watch("hst_amount") || 0) + (watch("pst_amount") || 0)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="text-sm font-medium text-slate-300 mb-2 block">
                    Notes (Optional)
                  </label>
                  <textarea
                    {...register("notes")}
                    rows={2}
                    className="input-field resize-none"
                    placeholder="Add any notes..."
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={verifyWithoutChanges}
                    disabled={isSubmitting}
                    className="btn-secondary flex-1"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Looks Good
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary flex-1"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

