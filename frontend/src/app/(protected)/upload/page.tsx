"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Camera,
  Image as ImageIcon,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowRight,
  RotateCcw,
  Plus,
  X,
  PenLine,
} from "lucide-react";
import toast from "react-hot-toast";
import { expensesApi } from "@/lib/firebase-api";
import { formatCurrency, cn } from "@/lib/utils";
import { categoryLabels } from "@/lib/store";
import { ReviewModal } from "@/components/expenses/ReviewModal";
import { ManualEntryModal } from "@/components/expenses/ManualEntryModal";

type UploadState = "idle" | "uploading" | "processing" | "success" | "error";

interface SelectedFile {
  file: File;
  preview: string;
}

export default function UploadPage() {
  const router = useRouter();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [processedExpense, setProcessedExpense] = useState<any>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setSelectedFiles((prev) => [...prev, ...newFiles]);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".jpeg", ".jpg", ".png", ".gif", ".webp", ".heic"],
    },
    maxFiles: 5,
    maxSize: 10 * 1024 * 1024, // 10MB per file
    disabled: uploadState !== "idle" && uploadState !== "error",
  });

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const processFiles = async () => {
    if (selectedFiles.length === 0) return;

    setUploadState("uploading");
    setProgress(0);
    setError(null);

    try {
      // Progress simulation
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 5, 30));
      }, 100);

      setUploadState("processing");
      setProgress(40);

      // Upload all files and process (multi-image support)
      const result = await expensesApi.uploadMultiple(selectedFiles.map(f => f.file));

      clearInterval(progressInterval);
      setProgress(100);
      setProcessedExpense(result);
      setUploadState("success");

      // Show review modal
      setTimeout(() => {
        setShowReviewModal(true);
      }, 500);
    } catch (err: any) {
      setUploadState("error");
      setError(err.message || "Failed to process receipt");
      toast.error("Failed to process receipt");
    }
  };

  const reset = () => {
    selectedFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setSelectedFiles([]);
    setUploadState("idle");
    setProgress(0);
    setProcessedExpense(null);
    setError(null);
  };

  const handleReviewComplete = () => {
    setShowReviewModal(false);
    toast.success("Expense saved successfully!");
    router.push("/expenses");
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white">Add Expense</h1>
        <p className="text-slate-400 mt-2">
          Upload a receipt or add manual entry (insurance, bank fees, etc.)
        </p>
      </div>

      {/* Entry Type Selector */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1 card p-4 border-2 border-yel-500/50 bg-yel-500/5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-yel-500/20 flex items-center justify-center">
              <Camera className="w-5 h-5 text-yel-500" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Upload Receipt</h3>
              <p className="text-xs text-slate-400">AI extracts data automatically</p>
            </div>
          </div>
        </div>
        <button 
          onClick={() => setShowManualEntryModal(true)}
          className="flex-1 card p-4 border-2 border-slate-700 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-slate-800 group-hover:bg-blue-500/20 flex items-center justify-center transition-colors">
              <PenLine className="w-5 h-5 text-slate-400 group-hover:text-blue-400 transition-colors" />
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-white">Manual Entry</h3>
              <p className="text-xs text-slate-400">Insurance, bank fees, etc.</p>
            </div>
          </div>
        </button>
      </div>

      {/* Upload Area */}
      <div className="card p-8">
        <AnimatePresence mode="wait">
          {uploadState === "idle" || uploadState === "error" ? (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Selected Files Preview */}
              {selectedFiles.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-slate-400">
                      {selectedFiles.length} görsel seçildi
                    </span>
                    <button
                      onClick={reset}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Tümünü Sil
                    </button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                    {selectedFiles.map((sf, index) => (
                      <div
                        key={index}
                        className="relative aspect-[3/4] rounded-lg overflow-hidden bg-slate-800 group"
                      >
                        <img
                          src={sf.preview}
                          alt={`Receipt ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeFile(index)}
                          className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                        <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                    {/* Add More Button */}
                    <div
                      {...getRootProps()}
                      className="aspect-[3/4] rounded-lg border-2 border-dashed border-slate-700 hover:border-amber-500 flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <input {...getInputProps()} />
                      <Plus className="w-8 h-8 text-slate-500" />
                    </div>
                  </div>
                </div>
              )}

              {/* Dropzone */}
              {selectedFiles.length === 0 && (
                <div
                  {...getRootProps()}
                  className={cn(
                    "relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all",
                    isDragActive
                      ? "border-amber-500 bg-amber-500/5"
                      : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/50"
                  )}
                >
                  <input {...getInputProps()} />

                  <div className="flex flex-col items-center gap-4">
                    <div
                      className={cn(
                        "w-16 h-16 rounded-2xl flex items-center justify-center transition-colors",
                        isDragActive
                          ? "bg-amber-500/20 text-amber-500"
                          : "bg-slate-800 text-slate-400"
                      )}
                    >
                      {isDragActive ? (
                        <Upload className="w-8 h-8" />
                      ) : (
                        <ImageIcon className="w-8 h-8" />
                      )}
                    </div>

                    <div>
                      <p className="text-lg font-medium text-white mb-1">
                        {isDragActive
                          ? "Fişleri buraya bırak"
                          : "Fiş görsellerini sürükle & bırak"}
                      </p>
                      <p className="text-slate-500">
                        veya tıkla • Birden fazla görsel seçebilirsin
                      </p>
                      <p className="text-slate-600 text-sm mt-1">
                        JPEG, PNG, HEIC • Maks 10MB/görsel
                      </p>
                    </div>
                  </div>

                  {/* Camera Button for Mobile */}
                  <div className="mt-6 pt-6 border-t border-slate-800">
                    <button
                      type="button"
                      className="btn-secondary w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.capture = "environment";
                        input.multiple = true;
                        input.onchange = (e: any) => {
                          if (e.target.files) {
                            onDrop(Array.from(e.target.files));
                          }
                        };
                        input.click();
                      }}
                    >
                      <Camera className="w-5 h-5" />
                      Fotoğraf Çek
                    </button>
                  </div>
                </div>
              )}

              {/* Process Button */}
              {selectedFiles.length > 0 && (
                <button
                  onClick={processFiles}
                  className="btn-primary w-full mt-4"
                >
                  <Upload className="w-5 h-5" />
                  {selectedFiles.length === 1
                    ? "Fişi İşle"
                    : `${selectedFiles.length} Görseli Birleştir ve İşle`}
                </button>
              )}

              {/* Error Message */}
              {error && (
                <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <div>
                      <p className="text-red-400 font-medium">{error}</p>
                      <button
                        onClick={reset}
                        className="text-sm text-red-500 hover:text-red-400 mt-1"
                      >
                        Tekrar Dene
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              {/* Preview Images */}
              {selectedFiles.length > 0 && (
                <div className="mb-6">
                  <div className="flex justify-center gap-2 flex-wrap">
                    {selectedFiles.slice(0, 3).map((sf, index) => (
                      <div
                        key={index}
                        className="relative w-20 h-28 rounded-lg overflow-hidden bg-slate-800"
                      >
                        <img
                          src={sf.preview}
                          alt={`Receipt ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        {uploadState !== "success" && (
                          <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                          </div>
                        )}
                      </div>
                    ))}
                    {selectedFiles.length > 3 && (
                      <div className="w-20 h-28 rounded-lg bg-slate-800 flex items-center justify-center">
                        <span className="text-slate-400 text-sm">
                          +{selectedFiles.length - 3}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Progress */}
              <div className="max-w-xs mx-auto mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-400">
                    {uploadState === "uploading" && "Yükleniyor..."}
                    {uploadState === "processing" && "AI ile işleniyor..."}
                    {uploadState === "success" && "Tamamlandı!"}
                  </span>
                  <span className="text-sm font-medium text-amber-500">
                    {progress}%
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className={cn(
                      "h-full rounded-full transition-colors",
                      uploadState === "success" ? "bg-emerald-500" : "bg-amber-500"
                    )}
                  />
                </div>
              </div>

              {/* Status */}
              {uploadState === "success" && processedExpense && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-center gap-2 text-emerald-500">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">Fiş işlendi!</span>
                  </div>

                  {/* Quick Preview */}
                  <div className="p-4 rounded-xl bg-slate-800/50 text-left max-w-sm mx-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Satıcı</span>
                        <span className="text-white font-medium">
                          {processedExpense.vendor_name || "Bilinmiyor"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Tutar</span>
                        <span className="text-white font-medium">
                          {formatCurrency(processedExpense.cad_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Kategori</span>
                        <span className="text-white font-medium">
                          {categoryLabels[processedExpense.category] ||
                            processedExpense.category}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3">
                    <button onClick={reset} className="btn-ghost">
                      <RotateCcw className="w-4 h-4" />
                      Yeni Fiş Yükle
                    </button>
                    <button
                      onClick={() => setShowReviewModal(true)}
                      className="btn-primary"
                    >
                      İncele & Onayla
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tips */}
      <div className="mt-8 p-6 rounded-2xl bg-slate-800/30 border border-slate-800">
        <h3 className="font-semibold text-white mb-3">İpuçları</h3>
        <ul className="space-y-2 text-slate-400 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-amber-500">•</span>
            Uzun fişler için birden fazla parça halinde fotoğraf çekebilirsin
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500">•</span>
            Görsellerin sırasına dikkat et (üstten alta)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500">•</span>
            Işık ve netlik kalitesi önemli
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500">•</span>
            Toplam ve tarih mutlaka görünür olmalı
          </li>
        </ul>
      </div>

      {/* Review Modal */}
      {processedExpense && (
        <ReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          expense={processedExpense}
          onSave={handleReviewComplete}
        />
      )}

      {/* Manual Entry Modal */}
      <ManualEntryModal
        isOpen={showManualEntryModal}
        onClose={() => setShowManualEntryModal(false)}
        onSuccess={() => {
          router.push("/expenses");
        }}
      />
    </div>
  );
}
