"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  Building,
  Tag,
  DollarSign,
  MapPin,
  CreditCard,
  CheckCircle,
  Clock,
  Edit,
  Trash2,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";
import { expensesApi } from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";
import { ReviewModal } from "@/components/expenses/ReviewModal";

export default function ExpenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);

  const { data: expense, isLoading, refetch } = useQuery({
    queryKey: ["expense", params.id],
    queryFn: () => expensesApi.get(params.id as string),
    enabled: !!params.id,
  });

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this expense?")) return;

    try {
      await expensesApi.delete(params.id as string);
      toast.success("Expense deleted");
      router.push("/expenses");
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to delete");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-yel-500 animate-spin" />
      </div>
    );
  }

  if (!expense) {
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-display font-bold text-white mb-2">
          Expense not found
        </h2>
        <Link href="/expenses" className="text-yel-500 hover:text-yel-400">
          Back to expenses
        </Link>
      </div>
    );
  }

  const color = categoryColors[expense.category] || "#6B7280";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back Button */}
      <Link
        href="/expenses"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Expenses
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-display font-bold text-white">
              {expense.vendor_name || "Unknown Vendor"}
            </h1>
            {expense.is_verified ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-sm font-medium">
                <CheckCircle className="w-4 h-4" />
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 text-sm font-medium">
                <Clock className="w-4 h-4" />
                Pending
              </span>
            )}
          </div>
          <p className="text-slate-400">
            {formatDate(expense.transaction_date, "long")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEditModal(true)} className="btn-secondary">
            <Edit className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="p-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Receipt Image */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Receipt</h2>
          {expense.receipt_image_url ? (
            <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800">
              <img
                src={expense.receipt_image_url}
                alt="Receipt"
                className="w-full h-full object-contain"
              />
              <a
                href={expense.receipt_image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-4 right-4 p-2 bg-slate-900/80 backdrop-blur rounded-lg text-white hover:bg-slate-800 transition-colors"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            </div>
          ) : (
            <div className="aspect-[3/4] rounded-xl bg-slate-800 flex items-center justify-center text-slate-500">
              No image available
            </div>
          )}
        </motion.div>

        {/* Details */}
        <div className="space-y-6">
          {/* Amount Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card p-6"
          >
            <h2 className="text-lg font-semibold text-white mb-4">Amount</h2>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-yel-500/10 to-orange-500/10 border border-yel-500/20">
                <p className="text-sm text-yel-400 mb-1">CAD Amount</p>
                <p className="text-3xl font-bold text-white">
                  {formatCurrency(expense.cad_amount)}
                </p>
              </div>

              {expense.original_currency === "USD" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-800/50">
                    <p className="text-sm text-slate-400 mb-1">Original (USD)</p>
                    <p className="text-xl font-semibold text-white">
                      {formatCurrency(expense.original_amount, "USD")}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-800/50">
                    <p className="text-sm text-slate-400 mb-1">Exchange Rate</p>
                    <p className="text-xl font-semibold text-white flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-slate-500" />
                      {expense.exchange_rate?.toFixed(4)}
                    </p>
                  </div>
                </div>
              )}

              {expense.tax_amount > 0 && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-sm text-emerald-400 mb-1">
                    GST/HST Recoverable
                  </p>
                  <p className="text-xl font-semibold text-white">
                    {formatCurrency(expense.tax_amount)}
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Details Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card p-6"
          >
            <h2 className="text-lg font-semibold text-white mb-4">Details</h2>
            <div className="space-y-4">
              <DetailRow
                icon={<Tag className="w-5 h-5" />}
                label="Category"
                value={
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium"
                    style={{
                      backgroundColor: `${color}20`,
                      color: color,
                    }}
                  >
                    {categoryLabels[expense.category] || expense.category}
                  </span>
                }
              />

              <DetailRow
                icon={<MapPin className="w-5 h-5" />}
                label="Jurisdiction"
                value={
                  <span className="text-white">
                    {expense.jurisdiction === "usa"
                      ? "🇺🇸 United States"
                      : expense.jurisdiction === "canada"
                      ? "🇨🇦 Canada"
                      : "Unknown"}
                  </span>
                }
              />

              {expense.card_last_4 && (
                <DetailRow
                  icon={<CreditCard className="w-5 h-5" />}
                  label="Payment Card"
                  value={
                    <div className="text-right">
                      <p className="text-white">•••• {expense.card_last_4}</p>
                      <p
                        className={cn(
                          "text-sm",
                          expense.payment_source === "personal_card"
                            ? "text-orange-400"
                            : expense.payment_source === "company_card"
                            ? "text-blue-400"
                            : "text-slate-500"
                        )}
                      >
                        {expense.payment_source === "personal_card"
                          ? "Due to Shareholder"
                          : expense.payment_source === "company_card"
                          ? "Company Card"
                          : "Unknown"}
                      </p>
                    </div>
                  }
                />
              )}

              {expense.notes && (
                <DetailRow
                  icon={<Building className="w-5 h-5" />}
                  label="Notes"
                  value={<span className="text-white">{expense.notes}</span>}
                />
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <ReviewModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          expense={expense}
          onSave={() => {
            setShowEditModal(false);
            refetch();
            toast.success("Expense updated");
          }}
        />
      )}
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-slate-800 last:border-0">
      <div className="flex items-center gap-3 text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      {value}
    </div>
  );
}

