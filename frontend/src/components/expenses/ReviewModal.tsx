"use client";

import { useState, useEffect } from "react";
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
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { expensesApi, cardsApi } from "@/lib/firebase-api";
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

  // Fetch registered cards for card selection
  const { data: cards } = useQuery({
    queryKey: ["cards"],
    queryFn: () => cardsApi.list(),
    enabled: isOpen,
  });

  // Convert transaction_date to YYYY-MM-DD for the date input (timezone-safe)
  const toDateInputValue = (d: any): string => {
    if (!d) return "";
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
    const date = d instanceof Date ? d : d?.toDate?.() || new Date(d);
    if (isNaN(date.getTime())) return "";
    // Use UTC to avoid timezone shift (e.g. 2026-02-12T00:00:00Z → Feb 11 in EST)
    return date.toISOString().substring(0, 10);
  };

  const { register, handleSubmit, watch, setValue, reset } = useForm({
    defaultValues: {
      vendor_name: expense.vendor_name || "",
      transaction_date: toDateInputValue(expense.transaction_date),
      category: expense.category || "uncategorized",
      original_amount: expense.original_amount || 0,
      gst_amount: expense.gst_amount || 0,
      hst_amount: expense.hst_amount || 0,
      pst_amount: expense.pst_amount || 0,
      card_last_4: expense.card_last_4 || "",
      notes: expense.notes || "",
    },
  });

  // Reset form when expense changes (e.g. open different expense)
  useEffect(() => {
    if (expense && isOpen) {
      reset({
        vendor_name: expense.vendor_name || "",
        transaction_date: toDateInputValue(expense.transaction_date),
        category: expense.category || "uncategorized",
        original_amount: expense.original_amount || 0,
        gst_amount: expense.gst_amount || 0,
        hst_amount: expense.hst_amount || 0,
        pst_amount: expense.pst_amount || 0,
        card_last_4: expense.card_last_4 || "",
        notes: expense.notes || "",
      });
    }
  }, [expense?.id, isOpen, reset]);

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      // Find the selected card to determine payment_source
      const selectedCard = cards?.find((c: any) => c.last_four === data.card_last_4);
      
      // Store date as noon UTC to avoid timezone shift (e.g. Feb 15 local → Feb 14 in EST)
      const dateStr = data.transaction_date ? String(data.transaction_date).substring(0, 10) : null;
      const isoDate = dateStr ? `${dateStr}T12:00:00.000Z` : null;

      await expensesApi.update(expense.id, {
        ...data,
        transaction_date: isoDate,
        card_last_4: data.card_last_4 || null,
        payment_source: selectedCard
          ? (selectedCard.is_company_card ? "company_card" : "personal_card")
          : expense.payment_source || "unknown",
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
      const selectedCardValue = watch("card_last_4");
      // If user selected a card, save it even when verifying without other changes
      if (selectedCardValue && selectedCardValue !== (expense.card_last_4 || "")) {
        const selectedCard = cards?.find((c: any) => c.last_four === selectedCardValue);
        await expensesApi.update(expense.id, {
          card_last_4: selectedCardValue,
          payment_source: selectedCard
            ? (selectedCard.is_company_card ? "company_card" : "personal_card")
            : expense.payment_source || "unknown",
          is_verified: true,
        });
      } else {
        await expensesApi.verify(expense.id);
      }
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
            {/* Bank Link Banner */}
            {expense.receipt_linked && (
              <div className="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <div>
                    <p className="text-blue-300 text-sm font-medium">Linked to bank statement</p>
                    <p className="text-blue-400/70 text-xs">
                      This receipt has been matched with a bank import transaction. Your tax details and receipt image are now attached.
                    </p>
                  </div>
                </div>
              </div>
            )}

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

                {/* Payment Card */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                    <CreditCard className="w-4 h-4" />
                    Payment Card
                  </label>
                  <select {...register("card_last_4")} className="input-field">
                    <option value="">Not specified</option>
                    {cards && (() => {
                      const cadCards = cards.filter((c: any) => c.currency === "CAD");
                      const usdCards = cards.filter((c: any) => c.currency === "USD");
                      const otherCards = cards.filter((c: any) => !c.currency);
                      return (
                        <>
                          {cadCards.length > 0 && (
                            <optgroup label="CAD Cards">
                              {cadCards.map((card: any) => (
                                <option key={card.id} value={card.last_four}>
                                  {card.card_name} (•••• {card.last_four}) - {card.is_company_card ? "Company" : "Personal"}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {usdCards.length > 0 && (
                            <optgroup label="USD Cards">
                              {usdCards.map((card: any) => (
                                <option key={card.id} value={card.last_four}>
                                  {card.card_name} (•••• {card.last_four}) - {card.is_company_card ? "Company" : "Personal"}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {otherCards.length > 0 && (
                            <optgroup label="Other Cards">
                              {otherCards.map((card: any) => (
                                <option key={card.id} value={card.last_four}>
                                  {card.card_name} (•••• {card.last_four}) - {card.is_company_card ? "Company" : "Personal"}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
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

