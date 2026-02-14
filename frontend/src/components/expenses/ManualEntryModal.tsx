"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Calendar,
  Building2,
  DollarSign,
  FileText,
  Upload,
  Loader2,
  Info,
  AlertTriangle,
  CheckCircle,
  CreditCard,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { expensesApi, revenueApi, storageApi, cardsApi } from "@/lib/firebase-api";
import { EXPENSE_CATEGORIES, getCategoryTooltip } from "@/lib/categories";
import { cn } from "@/lib/utils";

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ManualEntryModal({ isOpen, onClose, onSuccess }: ManualEntryModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [selectedCardLast4, setSelectedCardLast4] = useState<string>("");

  // Fetch cards for card selection
  const { data: cards } = useQuery({
    queryKey: ["cards"],
    queryFn: () => cardsApi.list(),
    enabled: isOpen,
  });
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    vendor_name: "",
    category: "office_admin",
    amount: "",
    currency: "CAD" as "CAD" | "USD",
    exchange_rate: "1.0",
    payment_source: "company_card" as "company_card" | "personal_card" | "bank_checking" | "e_transfer",
    notes: "",
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFile(file);
      setProofPreview(URL.createObjectURL(file));
    }
  };

  const handleCurrencyChange = async (newCurrency: "CAD" | "USD") => {
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
        setFormData(prev => ({ ...prev, exchange_rate: "1.40" }));
      } finally {
        setIsFetchingRate(false);
      }
    }
  };

  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setFormData(prev => ({ ...prev, date: newDate }));
    
    // Fetch rate if USD
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.vendor_name || !formData.amount) {
      toast.error("Please fill in Vendor Name and Amount");
      return;
    }

    setIsSubmitting(true);
    try {
      const amountOriginal = parseFloat(formData.amount);
      const exchangeRate = parseFloat(formData.exchange_rate);
      const amountCad = formData.currency === "CAD" 
        ? amountOriginal 
        : amountOriginal * exchangeRate;

      // Upload proof file if provided
      let proofImageUrl: string | null = null;
      if (proofFile) {
        toast.loading("Uploading proof...", { id: "manual-entry" });
        proofImageUrl = await storageApi.uploadReceipt(proofFile);
      }

      toast.loading("Saving expense...", { id: "manual-entry" });

      // Determine card and payment source from selected card
      const selectedCard = cards?.find((c: any) => c.last_four === selectedCardLast4);
      const paymentSource = selectedCard
        ? (selectedCard.is_company_card ? "company_card" : "personal_card")
        : formData.payment_source;

      // Create the manual expense entry
      await expensesApi.create({
        vendor_name: formData.vendor_name,
        transaction_date: new Date(formData.date),
        category: formData.category,
        jurisdiction: formData.currency === "USD" ? "usa" : "canada",
        original_amount: amountOriginal,
        original_currency: formData.currency,
        currency: formData.currency,
        tax_amount: 0,  // Manual entries typically don't have tax breakdown
        gst_amount: 0,
        hst_amount: 0,
        pst_amount: 0,
        exchange_rate: exchangeRate,
        cad_amount: Math.round(amountCad * 100) / 100,
        card_last_4: selectedCardLast4 || null,
        payment_source: paymentSource,
        receipt_image_url: proofImageUrl,
        proof_image_url: proofImageUrl,
        raw_ocr_text: null,
        is_verified: true,  // Manual entries are auto-verified
        processing_status: "completed",
        error_message: null,
        notes: formData.notes || null,
        entry_type: "manual",
      });

      toast.success("Manual expense added!", { id: "manual-entry" });
      onSuccess();
      onClose();
      
      // Reset form
      setFormData({
        date: new Date().toISOString().split("T")[0],
        vendor_name: "",
        category: "office_admin",
        amount: "",
        currency: "CAD",
        exchange_rate: "1.0",
        payment_source: "company_card",
        notes: "",
      });
      setProofFile(null);
      setProofPreview(null);
      setSelectedCardLast4("");
      
    } catch (error: any) {
      console.error("Failed to add manual expense:", error);
      toast.error(error.message || "Failed to add expense", { id: "manual-entry" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCategory = EXPENSE_CATEGORIES.find(c => c.id === formData.category);
  const isMealsCategory = formData.category === "meals_entertainment";
  const cadAmount = formData.currency === "CAD" 
    ? parseFloat(formData.amount || "0") 
    : parseFloat(formData.amount || "0") * parseFloat(formData.exchange_rate || "1");

  if (!isOpen) return null;

  return (
    <AnimatePresence>
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
          onClick={(e) => e.stopPropagation()}
          className="bg-slate-900 border border-slate-700 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700">
            <div>
              <h2 className="text-xl font-semibold text-white">Manual Entry</h2>
              <p className="text-sm text-slate-400 mt-1">Add expense without receipt</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Calendar className="w-4 h-4 inline mr-2" />
                Transaction Date *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={handleDateChange}
                className="input w-full"
                required
              />
            </div>

            {/* Vendor Name */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Building2 className="w-4 h-4 inline mr-2" />
                Vendor Name *
              </label>
              <input
                type="text"
                value={formData.vendor_name}
                onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                placeholder="e.g., TD Bank, Intact Insurance"
                className="input w-full"
                required
              />
            </div>

            {/* Category with Tooltip */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <FileText className="w-4 h-4 inline mr-2" />
                Category *
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input w-full"
              >
                {EXPENSE_CATEGORIES.filter(c => c.id !== "uncategorized").map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
              
              {/* Category Tooltip */}
              {selectedCategory && (
                <div className="mt-2 flex items-start gap-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-slate-400">{selectedCategory.tooltip}</p>
                </div>
              )}

              {/* Meals Warning */}
              {isMealsCategory && (
                <div className="mt-2 flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-400">
                    Only 50% of this expense is tax deductible (CRA rule)
                  </p>
                </div>
              )}
            </div>

            {/* Amount & Currency */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <DollarSign className="w-4 h-4 inline mr-2" />
                Amount *
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                    className="input w-full pl-8"
                    required
                  />
                </div>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange("CAD")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors",
                      formData.currency === "CAD"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    CAD
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange("USD")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors",
                      formData.currency === "USD"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    USD
                  </button>
                </div>
              </div>

              {/* Exchange Rate for USD */}
              {formData.currency === "USD" && (
                <div className="mt-3 p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">
                      Exchange Rate (Bank of Canada)
                    </span>
                    {isFetchingRate && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      step="0.0001"
                      value={formData.exchange_rate}
                      onChange={(e) => setFormData({ ...formData, exchange_rate: e.target.value })}
                      className="input w-24 text-center"
                    />
                    <span className="text-slate-400">=</span>
                    <span className="text-lg font-semibold text-green-400">
                      ${cadAmount.toFixed(2)} CAD
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Card */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <CreditCard className="w-4 h-4 inline mr-2" />
                Payment Card
              </label>
              <select
                value={selectedCardLast4}
                onChange={(e) => {
                  setSelectedCardLast4(e.target.value);
                  // Auto-set payment source based on card
                  if (e.target.value) {
                    const card = cards?.find((c: any) => c.last_four === e.target.value);
                    if (card) {
                      setFormData(prev => ({
                        ...prev,
                        payment_source: card.is_company_card ? "company_card" : "personal_card"
                      }));
                    }
                  }
                }}
                className="input w-full"
              >
                <option value="">No card / Other payment</option>
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

            {/* Payment Source (shown when no card selected) */}
            {!selectedCardLast4 && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Payment Source
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, payment_source: "company_card" })}
                    className={cn(
                      "py-2 px-3 rounded-lg text-sm font-medium transition-colors border",
                      formData.payment_source === "company_card"
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    Company Card
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, payment_source: "personal_card" })}
                    className={cn(
                      "py-2 px-3 rounded-lg text-sm font-medium transition-colors border",
                      formData.payment_source === "personal_card"
                        ? "bg-purple-600 border-purple-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    Personal Card
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, payment_source: "bank_checking" })}
                    className={cn(
                      "py-2 px-3 rounded-lg text-sm font-medium transition-colors border",
                      formData.payment_source === "bank_checking"
                        ? "bg-emerald-600 border-emerald-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    Bank / Checking
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, payment_source: "e_transfer" })}
                    className={cn(
                      "py-2 px-3 rounded-lg text-sm font-medium transition-colors border",
                      formData.payment_source === "e_transfer"
                        ? "bg-amber-600 border-amber-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    e-Transfer
                  </button>
                </div>
                {formData.payment_source === "personal_card" && (
                  <p className="text-xs text-purple-400 mt-2">
                    → Will be added to &quot;Due to Shareholder&quot;
                  </p>
                )}
              </div>
            )}

            {/* Proof of Payment (Optional) */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Upload className="w-4 h-4 inline mr-2" />
                Proof of Payment (Optional)
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Bank screenshot, invoice, or any supporting document
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              {proofPreview ? (
                <div className="relative">
                  <img
                    src={proofPreview}
                    alt="Proof preview"
                    className="w-full h-32 object-cover rounded-lg border border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setProofFile(null);
                      setProofPreview(null);
                    }}
                    className="absolute top-2 right-2 p-1 bg-red-500 rounded-full"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 border-2 border-dashed border-slate-700 rounded-lg text-slate-400 hover:border-slate-600 hover:text-slate-300 transition-colors"
                >
                  Click to upload proof
                </button>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any additional notes..."
                rows={2}
                className="input w-full resize-none"
              />
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 px-4 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 px-4 bg-yel-500 text-slate-900 font-semibold rounded-lg hover:bg-yel-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Add Expense
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

