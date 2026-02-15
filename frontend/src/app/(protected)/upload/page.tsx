"use client";

import { useState, useCallback, useRef } from "react";
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
  AlertTriangle,
  ChevronDown,
  Link2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [processedExpense, setProcessedExpense] = useState<any>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

  const processFiles = async (skipDuplicateCheck = false) => {
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
      const result = await expensesApi.uploadMultiple(
        selectedFiles.map(f => f.file),
        skipDuplicateCheck
      );

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
      if (err.message?.startsWith("DUPLICATE_RECEIPT")) {
        // Extract the readable part after the prefix
        const msg = err.message.replace("DUPLICATE_RECEIPT: ", "");
        setError(msg);
        toast.error("Duplicate receipt detected!");
      } else {
        setError(err.message || "Failed to process receipt");
        toast.error("Failed to process receipt");
      }
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
    // Invalidate all expenses caches so the list shows the new expense immediately
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    toast.success("Expense saved successfully!");
    router.push("/expenses");
  };

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onDrop(Array.from(e.target.files));
    }
    // Reset the input value so the same file can be selected again
    e.target.value = "";
  }, [onDrop]);

  const triggerCamera = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
      cameraInputRef.current.click();
    }
  };

  const triggerGallery = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
      galleryInputRef.current.click();
    }
  };

  const [showTips, setShowTips] = useState(false);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Persistent hidden file inputs — iOS Safari garbage-collects dynamically created ones */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />
      {/* Page Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-white">Add Expense</h1>
        <p className="text-slate-400 mt-1 text-sm md:text-base">
          Snap a receipt or add a manual entry
        </p>
      </div>

      <AnimatePresence mode="wait">
        {uploadState === "idle" || uploadState === "error" ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* === MOBILE: Camera Hero Button === */}
            {selectedFiles.length === 0 && (
              <div className="md:hidden space-y-3">
                {/* Primary: Camera Capture */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => triggerCamera()}
                  className="w-full relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-6 shadow-xl shadow-amber-500/25 active:shadow-amber-500/40 transition-shadow"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                      <Camera className="w-7 h-7 text-slate-950" />
                    </div>
                    <div className="text-left">
                      <p className="text-lg font-bold text-slate-950">Take Photo</p>
                      <p className="text-sm text-slate-950/70">
                        Snap a receipt — AI extracts all data
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-950/60 ml-auto" />
                  </div>
                </motion.button>

                {/* Secondary Actions */}
                <div className="flex gap-3">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => triggerGallery()}
                    className="flex-1 flex items-center gap-3 p-4 rounded-xl bg-slate-800/80 border border-slate-700 active:bg-slate-700 transition-colors"
                  >
                    <ImageIcon className="w-5 h-5 text-slate-400" />
                    <span className="text-sm font-medium text-white">Gallery</span>
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowManualEntryModal(true)}
                    className="flex-1 flex items-center gap-3 p-4 rounded-xl bg-slate-800/80 border border-slate-700 active:bg-slate-700 transition-colors"
                  >
                    <PenLine className="w-5 h-5 text-slate-400" />
                    <span className="text-sm font-medium text-white">Manual</span>
                  </motion.button>
                </div>
              </div>
            )}

            {/* === DESKTOP: Drag-and-Drop with Manual Entry option === */}
            {selectedFiles.length === 0 && (
              <div className="hidden md:block">
                <div className="flex gap-4 mb-4">
                  <div className="flex-1 card p-4 border-2 border-yel-500/50 bg-yel-500/5">
                    <div className="flex items-center gap-3">
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
                    <div className="flex items-center gap-3">
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

                <div className="card p-8">
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
                            ? "Drop receipts here"
                            : "Drag & drop receipt images"}
                        </p>
                        <p className="text-slate-500">
                          or click to browse • Multiple images supported
                        </p>
                        <p className="text-slate-600 text-sm mt-1">
                          JPEG, PNG, HEIC • Max 10MB per image
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* === Selected Files Preview (both mobile & desktop) === */}
            {selectedFiles.length > 0 && (
              <div className="card p-4 md:p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-white">
                    {selectedFiles.length} image{selectedFiles.length > 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={reset}
                    className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {selectedFiles.map((sf, index) => (
                    <div
                      key={index}
                      className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800 group"
                    >
                      <img
                        src={sf.preview}
                        alt={`Receipt ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => removeFile(index)}
                        className="absolute top-1.5 right-1.5 w-7 h-7 bg-red-500/90 rounded-full flex items-center justify-center opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                      <div className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                        {index + 1}
                      </div>
                    </div>
                  ))}
                  {/* Add More */}
                  <button
                    onClick={() => triggerGallery()}
                    className="aspect-[3/4] rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-500 flex flex-col items-center justify-center cursor-pointer transition-colors gap-1"
                  >
                    <Plus className="w-6 h-6 text-slate-500" />
                    <span className="text-[10px] text-slate-500">Add</span>
                  </button>
                </div>

                {/* Process Button */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => processFiles()}
                  className="btn-primary w-full mt-4"
                >
                  <Upload className="w-5 h-5" />
                  {selectedFiles.length === 1
                    ? "Process Receipt"
                    : `Merge & Process ${selectedFiles.length} Images`}
                </motion.button>
              </div>
            )}

            {/* Error Message */}
            {error && (() => {
              const isDuplicate = error.includes("already been uploaded") || error.includes("appears to have been uploaded");
              return (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-xl border ${isDuplicate
                    ? "bg-amber-500/10 border-amber-500/20"
                    : "bg-red-500/10 border-red-500/20"
                    }`}
                >
                  <div className="flex items-start gap-3">
                    {isDuplicate ? (
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className={`font-medium ${isDuplicate ? "text-amber-400" : "text-red-400"}`}>
                        {isDuplicate ? "Duplicate Receipt Detected" : "Processing Error"}
                      </p>
                      <p className="text-slate-400 text-sm mt-1">{error}</p>
                      <div className="flex flex-wrap gap-3 mt-3">
                        <button
                          onClick={reset}
                          className="text-sm text-slate-300 hover:text-white font-medium"
                        >
                          Upload Different Receipt
                        </button>
                        {isDuplicate && (
                          <>
                            <button
                              onClick={() => processFiles(true)}
                              className="text-sm text-amber-500 hover:text-amber-400 font-semibold flex items-center gap-1"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Upload Anyway
                            </button>
                            <button
                              onClick={() => router.push("/expenses")}
                              className="text-sm text-slate-400 hover:text-slate-300 font-medium"
                            >
                              View Expenses
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })()}
          </motion.div>
        ) : (
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card p-6 md:p-8"
          >
            {/* Processing Animation */}
            <div className="text-center">
              {/* Preview thumbnails */}
              {selectedFiles.length > 0 && (
                <div className="mb-6">
                  <div className="flex justify-center gap-2 flex-wrap">
                    {selectedFiles.slice(0, 3).map((sf, index) => (
                      <div
                        key={index}
                        className="relative w-16 h-22 md:w-20 md:h-28 rounded-lg overflow-hidden bg-slate-800"
                      >
                        <img
                          src={sf.preview}
                          alt={`Receipt ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        {uploadState !== "success" && (
                          <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                            <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                          </div>
                        )}
                        {uploadState === "success" && (
                          <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                          </div>
                        )}
                      </div>
                    ))}
                    {selectedFiles.length > 3 && (
                      <div className="w-16 h-22 md:w-20 md:h-28 rounded-lg bg-slate-800 flex items-center justify-center">
                        <span className="text-slate-400 text-sm">
                          +{selectedFiles.length - 3}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Progress Ring */}
              {uploadState !== "success" && (
                <div className="flex flex-col items-center gap-3 mb-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-slate-800">
                      <div className="w-full h-full rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
                    </div>
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      {uploadState === "uploading" ? "Uploading..." : "Processing with AI..."}
                    </p>
                    <p className="text-slate-500 text-sm mt-0.5">This takes a few seconds</p>
                  </div>
                </div>
              )}

              {/* Progress Bar */}
              <div className="max-w-xs mx-auto mb-6">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-500">
                    {uploadState === "success" ? "Done" : "Processing"}
                  </span>
                  <span className="text-xs font-medium text-amber-500">
                    {progress}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ ease: "easeOut" }}
                    className={cn(
                      "h-full rounded-full",
                      uploadState === "success"
                        ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                        : "bg-gradient-to-r from-amber-500 to-amber-400"
                    )}
                  />
                </div>
              </div>

              {/* Success State */}
              {uploadState === "success" && processedExpense && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-center gap-2">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.3 }}
                    >
                      <CheckCircle className="w-6 h-6 text-emerald-500" />
                    </motion.div>
                    <span className="font-semibold text-emerald-400">Receipt processed!</span>
                  </div>

                  {/* Bank Match Banner */}
                  {(processedExpense.receipt_linked || processedExpense.bank_linked) && (
                    <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-left max-w-sm mx-auto">
                      <div className="flex items-start gap-2">
                        <Link2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-cyan-300 text-sm font-medium">Matched with bank transaction ✅</p>
                          <p className="text-cyan-400/70 text-xs mt-0.5">
                            Receipt matched to existing bank import. Tax details added.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick Preview Card */}
                  <div className="p-4 rounded-xl bg-slate-800/50 text-left max-w-sm mx-auto">
                    <div className="space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-sm">Vendor</span>
                        <span className="text-white font-medium">
                          {processedExpense.vendor_name || "Unknown"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-sm">Amount</span>
                        <span className="text-xl font-bold text-white">
                          {formatCurrency(processedExpense.cad_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-sm">Category</span>
                        <span className="text-white font-medium text-sm">
                          {categoryLabels[processedExpense.category] ||
                            processedExpense.category}
                        </span>
                      </div>
                      {(processedExpense.gst_amount > 0 || processedExpense.hst_amount > 0 || processedExpense.pst_amount > 0) && (
                        <>
                          <div className="border-t border-slate-700 pt-2">
                            <span className="text-slate-500 text-xs uppercase tracking-wider">Tax Details</span>
                          </div>
                          {processedExpense.gst_amount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-slate-400 text-sm">GST (5%)</span>
                              <span className="text-emerald-400 text-sm font-medium">
                                {formatCurrency(processedExpense.gst_amount)}
                              </span>
                            </div>
                          )}
                          {processedExpense.hst_amount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-slate-400 text-sm">HST</span>
                              <span className="text-emerald-400 text-sm font-medium">
                                {formatCurrency(processedExpense.hst_amount)}
                              </span>
                            </div>
                          )}
                          {processedExpense.pst_amount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-slate-400 text-sm">PST/QST</span>
                              <span className="text-orange-400 text-sm font-medium">
                                {formatCurrency(processedExpense.pst_amount)}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button onClick={reset} className="btn-ghost text-sm">
                      <RotateCcw className="w-4 h-4" />
                      Upload Another
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setShowReviewModal(true)}
                      className="btn-primary"
                    >
                      Review & Approve
                      <ArrowRight className="w-4 h-4" />
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tips — collapsible on mobile */}
      <div className="mt-6">
        <button
          onClick={() => setShowTips(!showTips)}
          className="md:hidden w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/30 border border-slate-800 text-sm"
        >
          <span className="text-slate-400 font-medium">Tips for best results</span>
          <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", showTips && "rotate-180")} />
        </button>
        <div className={cn(
          "md:block mt-2 md:mt-0",
          showTips ? "block" : "hidden"
        )}>
          <div className="p-4 md:p-6 rounded-2xl bg-slate-800/30 border border-slate-800">
            <h3 className="font-semibold text-white mb-3 hidden md:block">Tips</h3>
            <ul className="space-y-2 text-slate-400 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-amber-500">•</span>
                For long receipts, take multiple photos in parts
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500">•</span>
                Images are processed in order — top to bottom
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500">•</span>
                Good lighting and clarity improve accuracy
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500">•</span>
                Total and date must be clearly visible
              </li>
            </ul>
          </div>
        </div>
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
