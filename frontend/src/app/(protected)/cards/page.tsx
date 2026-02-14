"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Plus,
  Trash2,
  Building2,
  User,
  Loader2,
  X,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { cardsApi } from "@/lib/firebase-api";
import { formatDate } from "@/lib/utils";

const cardSchema = z.object({
  last_four: z
    .string()
    .length(4, "Must be exactly 4 digits")
    .regex(/^\d+$/, "Must be numbers only"),
  card_name: z.string().min(2, "Name is required"),
  is_company_card: z.boolean(),
  currency: z.enum(["CAD", "USD"]),
});

type CardForm = z.infer<typeof cardSchema>;

export default function CardsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: cards, isLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: () => cardsApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: cardsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("Card removed");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to delete card");
    },
  });

  const handleDelete = (id: string) => {
    if (confirm("Remove this card?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">
            Payment Cards
          </h1>
          <p className="text-slate-400 mt-1">
            Manage your payment cards for expense tracking
          </p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          <Plus className="w-5 h-5" />
          Add Card
        </button>
      </div>

      {/* Info Card */}
      <div className="p-4 rounded-xl bg-yel-500/10 border border-yel-500/20">
        <p className="text-yel-400 text-sm">
          <strong>How it works:</strong> When you upload a receipt, we extract
          the last 4 digits of the card used. If it matches a card you've added
          here, we automatically tag the expense as either "Business Expense" or
          "Due to Shareholder".
        </p>
      </div>

      {/* Cards List */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-8 h-8 text-yel-500 animate-spin mx-auto" />
          </div>
        ) : (cards?.length ?? 0) > 0 ? (
          <div className="divide-y divide-slate-800">
            {cards?.map((card: any) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      card.is_company_card
                        ? "bg-blue-500/20 text-blue-500"
                        : "bg-purple-500/20 text-purple-500"
                    }`}
                  >
                    <CreditCard className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium">{card.card_name}</p>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          card.is_company_card
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-purple-500/10 text-purple-400"
                        }`}
                      >
                        {card.is_company_card ? (
                          <>
                            <Building2 className="w-3 h-3" />
                            Company
                          </>
                        ) : (
                          <>
                            <User className="w-3 h-3" />
                            Personal
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm flex items-center gap-2">
                      <span>•••• •••• •••• {card.last_four}</span>
                      {card.currency && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          card.currency === "USD" 
                            ? "bg-blue-500/10 text-blue-400" 
                            : "bg-emerald-500/10 text-emerald-400"
                        }`}>
                          {card.currency}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(card.id)}
                  disabled={deleteMutation.isPending}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
              <CreditCard className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              No cards added yet
            </h3>
            <p className="text-slate-400 mb-4">
              Add your company and personal cards to automatically track payment
              sources
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary"
            >
              <Plus className="w-5 h-5" />
              Add Your First Card
            </button>
          </div>
        )}
      </div>

      {/* Add Card Modal */}
      <AddCardModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          setShowAddModal(false);
          queryClient.invalidateQueries({ queryKey: ["cards"] });
        }}
      />
    </div>
  );
}

function AddCardModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CardForm>({
    resolver: zodResolver(cardSchema),
    defaultValues: {
      is_company_card: true,
      currency: "CAD",
    },
  });

  const onSubmit = async (data: CardForm) => {
    setIsSubmitting(true);
    try {
      await cardsApi.create(data);
      toast.success("Card added successfully");
      reset();
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to add card");
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
          className="relative w-full max-w-md bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-800">
            <h2 className="text-xl font-display font-bold text-white">
              Add Payment Card
            </h2>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
            {/* Card Name */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Card Name
              </label>
              <input
                type="text"
                {...register("card_name")}
                className="input-field"
                placeholder="e.g., Company Visa, Personal Amex"
              />
              {errors.card_name && (
                <p className="text-red-400 text-sm mt-1">
                  {errors.card_name.message}
                </p>
              )}
            </div>

            {/* Last 4 Digits */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Last 4 Digits
              </label>
              <input
                type="text"
                {...register("last_four")}
                className="input-field"
                placeholder="1234"
                maxLength={4}
              />
              {errors.last_four && (
                <p className="text-red-400 text-sm mt-1">
                  {errors.last_four.message}
                </p>
              )}
            </div>

            {/* Card Type */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Card Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="relative">
                  <input
                    type="radio"
                    value="true"
                    {...register("is_company_card", {
                      setValueAs: (v) => v === "true",
                    })}
                    className="peer sr-only"
                    defaultChecked
                  />
                  <div className="p-4 rounded-xl border-2 border-slate-700 peer-checked:border-blue-500 peer-checked:bg-blue-500/10 cursor-pointer transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-5 h-5 text-blue-500" />
                      <span className="font-medium text-white">Company</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Tagged as "Business Expense"
                    </p>
                  </div>
                </label>
                <label className="relative">
                  <input
                    type="radio"
                    value="false"
                    {...register("is_company_card", {
                      setValueAs: (v) => v === "true",
                    })}
                    className="peer sr-only"
                  />
                  <div className="p-4 rounded-xl border-2 border-slate-700 peer-checked:border-purple-500 peer-checked:bg-purple-500/10 cursor-pointer transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-5 h-5 text-purple-500" />
                      <span className="font-medium text-white">Personal</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Tagged as "Due to Shareholder"
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Currency */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Card Currency
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="relative">
                  <input
                    type="radio"
                    value="CAD"
                    {...register("currency")}
                    className="peer sr-only"
                    defaultChecked
                  />
                  <div className="p-3 rounded-xl border-2 border-slate-700 peer-checked:border-emerald-500 peer-checked:bg-emerald-500/10 cursor-pointer transition-all text-center">
                    <span className="font-medium text-white">CAD</span>
                    <p className="text-xs text-slate-400 mt-0.5">Canadian Dollar</p>
                  </div>
                </label>
                <label className="relative">
                  <input
                    type="radio"
                    value="USD"
                    {...register("currency")}
                    className="peer sr-only"
                  />
                  <div className="p-3 rounded-xl border-2 border-slate-700 peer-checked:border-blue-500 peer-checked:bg-blue-500/10 cursor-pointer transition-all text-center">
                    <span className="font-medium text-white">USD</span>
                    <p className="text-xs text-slate-400 mt-0.5">US Dollar</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary flex-1"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Plus className="w-5 h-5" />
                )}
                Add Card
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

