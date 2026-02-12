"use client";

import React, { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Upload,
  FileSpreadsheet,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  DollarSign,
  TrendingDown,
  ArrowUpDown,
  Check,
  X,
  Eye,
  Percent,
  AlertTriangle,
  ShieldAlert,
  Copy,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  bankImportApi,
  factoringApi,
  duplicateCheckApi,
  revenueApi,
  BankTransaction,
  BankImportSummary,
  FactoringEntry,
  FactoringReportData,
} from "@/lib/firebase-api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { categoryLabels, categoryColors } from "@/lib/store";

type ActiveTab = "bank" | "factoring";
type ImportStep = "upload" | "review" | "done";

export default function ImportPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("bank");
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    expenses_deleted: number;
    revenues_deleted: number;
    fingerprints_cleared: number;
    total_amount_removed: number;
  } | null>(null);
  const queryClient = useQueryClient();

  const handleCleanup = async () => {
    if (!confirm(
      "This will remove all misclassified bank import entries:\n\n" +
      "• Expenses: Funds transfers, Cash withdrawals, Credit card payments\n" +
      "• Revenues: Credit card payments, Internal transfers, Owner contributions\n\n" +
      "You can then re-import the CSV files to get correct data.\n\nContinue?"
    )) return;

    setIsCleaningUp(true);
    toast.loading("Cleaning up misclassified data...", { id: "cleanup" });
    try {
      const result = await bankImportApi.cleanupMisclassifiedData();
      setCleanupResult(result);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["revenues"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      toast.success(
        `Cleaned up: ${result.expenses_deleted} bad expenses, ${result.revenues_deleted} bad revenues removed ($${result.total_amount_removed.toLocaleString()} CAD)`,
        { id: "cleanup", duration: 8000 }
      );
    } catch (error: any) {
      toast.error(error.message || "Cleanup failed", { id: "cleanup" });
    } finally {
      setIsCleaningUp(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">
            Import Data
          </h1>
          <p className="text-slate-400 mt-1">
            Import bank statements and factoring reports automatically
          </p>
        </div>
        <button
          onClick={handleCleanup}
          disabled={isCleaningUp}
          className="text-xs px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 transition-all flex items-center gap-1.5"
          title="Remove misclassified transfers, owner draws, and credit card payments from expenses/revenue"
        >
          {isCleaningUp ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Cleaning...
            </>
          ) : (
            <>
              <XCircle className="w-3 h-3" />
              Clean Up Bad Data
            </>
          )}
        </button>
      </div>

      {/* Cleanup Result */}
      {cleanupResult && (cleanupResult.expenses_deleted > 0 || cleanupResult.revenues_deleted > 0) && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
          <div className="flex items-center gap-2 text-emerald-400 mb-2">
            <CheckCircle className="w-5 h-5" />
            <span className="font-semibold">Cleanup Complete</span>
          </div>
          <div className="text-sm text-slate-300 space-y-1">
            {cleanupResult.expenses_deleted > 0 && (
              <p>{cleanupResult.expenses_deleted} misclassified expenses removed (transfers, cash withdrawals)</p>
            )}
            {cleanupResult.revenues_deleted > 0 && (
              <p>{cleanupResult.revenues_deleted} misclassified revenues removed (credit card payments, internal transfers)</p>
            )}
            <p className="text-amber-400">Total removed: ${cleanupResult.total_amount_removed.toLocaleString(undefined, { minimumFractionDigits: 2 })} CAD</p>
            <p className="text-xs text-slate-500 mt-2">You can now re-import your CSV files to get correctly categorized data.</p>
          </div>
        </div>
      )}

      {/* Tab Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab("bank")}
          className={cn(
            "flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all",
            activeTab === "bank"
              ? "border-amber-500/50 bg-amber-500/5"
              : "border-slate-700 hover:border-slate-600 bg-slate-900/50"
          )}
        >
          <div
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center",
              activeTab === "bank"
                ? "bg-amber-500/20 text-amber-500"
                : "bg-slate-800 text-slate-400"
            )}
          >
            <Building2 className="w-6 h-6" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-white">Bank Statement</h3>
            <p className="text-xs text-slate-400">
              Import RBC CSV transactions
            </p>
          </div>
        </button>

        <button
          onClick={() => setActiveTab("factoring")}
          className={cn(
            "flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all",
            activeTab === "factoring"
              ? "border-amber-500/50 bg-amber-500/5"
              : "border-slate-700 hover:border-slate-600 bg-slate-900/50"
          )}
        >
          <div
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center",
              activeTab === "factoring"
                ? "bg-amber-500/20 text-amber-500"
                : "bg-slate-800 text-slate-400"
            )}
          >
            <Percent className="w-6 h-6" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-white">Factoring Reports</h3>
            <p className="text-xs text-slate-400">
              Import J D Factors PDF reports
            </p>
          </div>
        </button>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === "bank" ? (
          <motion.div
            key="bank"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            <BankImportSection />
          </motion.div>
        ) : (
          <motion.div
            key="factoring"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <FactoringImportSection />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================
// BANK IMPORT SECTION
// =============================================

function BankImportSection() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<ImportStep>("upload");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [summary, setSummary] = useState<BankImportSummary | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [csvContentRef, setCsvContentRef] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }

    setIsProcessing(true);
    setDuplicateWarning(null);
    toast.loading("Checking for duplicates...", { id: "bank-parse" });

    try {
      const csvContent = await file.text();
      setCsvContentRef(csvContent);
      setUploadedFileName(file.name);

      // 1. Check file-level duplicate
      const fileCheck = await duplicateCheckApi.checkFileHash(csvContent, "bank_csv");
      if (fileCheck.isDuplicate) {
        const importDate = fileCheck.importedAt
          ? fileCheck.importedAt.toLocaleDateString("en-CA")
          : "unknown date";
        setDuplicateWarning(
          `This exact CSV file was already imported on ${importDate}. Duplicate records will be automatically skipped.`
        );
      }

      // 2. Parse CSV with AI
      toast.loading("Parsing bank statement...", { id: "bank-parse" });
      const result = await bankImportApi.parseCSV(csvContent);

      // Mark all transactions as selected by default
      const withSelection = result.transactions.map((tx) => ({
        ...tx,
        selected: tx.type === "expense" || tx.type === "income",
      }));

      setTransactions(withSelection);
      setSummary(result.summary);
      setStep("review");
      toast.success(
        `Found ${result.summary.total_transactions} transactions`,
        { id: "bank-parse" }
      );
    } catch (error: any) {
      toast.error(error.message || "Failed to parse CSV", {
        id: "bank-parse",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleTransaction = (index: number) => {
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.index === index ? { ...tx, selected: !tx.selected } : tx
      )
    );
  };

  const selectAll = (type: string) => {
    setTransactions((prev) =>
      prev.map((tx) => (tx.type === type ? { ...tx, selected: true } : tx))
    );
  };

  const deselectAll = () => {
    setTransactions((prev) => prev.map((tx) => ({ ...tx, selected: false })));
  };

  const handleImport = async (forceReimport = false) => {
    const selected = transactions.filter((tx) => tx.selected);
    if (selected.length === 0) {
      toast.error("Please select at least one transaction to import");
      return;
    }

    setIsProcessing(true);
    toast.loading(
      forceReimport
        ? `Force re-importing ${selected.length} transactions...`
        : `Importing ${selected.length} transactions...`,
      { id: "bank-import" }
    );

    try {
      const result = await bankImportApi.importTransactions(selected, forceReimport);
      setImportResult(result);
      setStep("done");

      // Register file hash after successful import
      if (csvContentRef) {
        await duplicateCheckApi.registerFileImport(csvContentRef, "bank_csv", {
          filename: uploadedFileName || "unknown.csv",
          records_count: result.expenses_created + result.revenues_created,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["revenues"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["revenue-summary"] });

      const extraMsgs: string[] = [];
      if (result.replaced > 0) extraMsgs.push(`${result.replaced} corrected`);
      if (result.duplicates_skipped > 0) extraMsgs.push(`${result.duplicates_skipped} duplicates skipped`);
      const extra = extraMsgs.length > 0 ? ` (${extraMsgs.join(", ")})` : "";
      toast.success(
        `Imported ${result.expenses_created} expenses, ${result.revenues_created} revenues${extra}`,
        { id: "bank-import" }
      );
    } catch (error: any) {
      toast.error(error.message || "Import failed", { id: "bank-import" });
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setTransactions([]);
    setSummary(null);
    setImportResult(null);
    setDuplicateWarning(null);
    setCsvContentRef(null);
    setUploadedFileName(null);
  };

  if (step === "upload") {
    return (
      <div className="card p-8">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <FileSpreadsheet className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Upload RBC Bank Statement
          </h3>
          <p className="text-slate-400 text-sm mb-6">
            Download your transactions from RBC Online Banking as CSV and upload
            here. AI will automatically categorize each transaction.
          </p>

          <label className="btn-primary inline-flex cursor-pointer">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isProcessing}
            />
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Select CSV File
              </>
            )}
          </label>

          <div className="mt-6 p-4 rounded-xl bg-slate-800/50 text-left">
            <h4 className="text-sm font-medium text-white mb-2">
              How to download from RBC:
            </h4>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
              <li>Log in to RBC Online Banking</li>
              <li>
                Go to your Business Chequing account {">"} Account Activity
              </li>
              <li>Select date range and click &quot;Download Transactions&quot;</li>
              <li>Choose CSV format and download</li>
              <li>Upload the downloaded file here</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="card p-8 text-center">
        <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-white mb-2">
          Import Complete!
        </h3>
        <div className="space-y-2 mb-6">
          {importResult?.expenses_created > 0 && (
            <p className="text-slate-300">
              <span className="text-red-400 font-bold">
                {importResult.expenses_created}
              </span>{" "}
              expenses created
            </p>
          )}
          {importResult?.revenues_created > 0 && (
            <p className="text-slate-300">
              <span className="text-emerald-400 font-bold">
                {importResult.revenues_created}
              </span>{" "}
              revenue entries created
            </p>
          )}
          {importResult?.skipped > 0 && (
            <p className="text-slate-500">
              {importResult.skipped} transactions skipped (transfers/draws)
            </p>
          )}
          {importResult?.replaced > 0 && (
            <div className="flex items-center justify-center gap-2 text-blue-400">
              <ArrowUpDown className="w-4 h-4" />
              <p className="text-sm">
                <span className="font-bold">{importResult.replaced}</span>{" "}
                bad records corrected and re-imported
              </p>
            </div>
          )}
          {importResult?.duplicates_skipped > 0 && (
            <div className="flex items-center justify-center gap-2 text-amber-400">
              <ShieldAlert className="w-4 h-4" />
              <p className="text-sm">
                <span className="font-bold">{importResult.duplicates_skipped}</span>{" "}
                duplicate transactions detected and skipped
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-3">
          <button onClick={reset} className="btn-primary">
            Import Another Statement
          </button>
          {importResult?.duplicates_skipped > 0 && importResult?.expenses_created === 0 && importResult?.revenues_created === 0 && (
            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl max-w-md">
              <p className="text-sm text-amber-300 mb-3">
                All transactions were skipped as duplicates. If the previous import had errors (e.g. wrong currency amounts), you can force re-import to replace them.
              </p>
              <button
                onClick={() => {
                  setStep("review");
                  setImportResult(null);
                }}
                className="w-full px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold rounded-lg border border-amber-500/40 transition-all flex items-center justify-center gap-2"
              >
                <ArrowUpDown className="w-4 h-4" />
                Go Back &amp; Force Re-import
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Review step
  const selectedCount = transactions.filter((tx) => tx.selected).length;
  const selectedExpenses = transactions.filter(
    (tx) => tx.selected && tx.type === "expense"
  );
  const selectedIncome = transactions.filter(
    (tx) => tx.selected && tx.type === "income"
  );

  return (
    <div className="space-y-6">
      {/* Duplicate Warning */}
      {duplicateWarning && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              Duplicate File Detected
            </p>
            <p className="text-xs text-amber-500/70 mt-1">
              {duplicateWarning}
            </p>
          </div>
        </motion.div>
      )}

      {/* Account Currency Badge */}
      {summary?.account_currency && summary.account_currency !== "CAD" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl"
        >
          <DollarSign className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <p className="text-sm text-blue-400">
            <span className="font-bold">{summary.account_currency} Account</span> detected.
            {" "}All amounts will be converted to CAD using Bank of Canada exchange rates during import.
          </p>
        </motion.div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat
            label="Total Transactions"
            value={summary.total_transactions.toString()}
            color="slate"
          />
          <MiniStat
            label={`Expenses (${summary.account_currency || "CAD"})`}
            value={formatCurrency(summary.total_expenses, summary.account_currency || "CAD")}
            color="red"
          />
          <MiniStat
            label={`Income (${summary.account_currency || "CAD"})`}
            value={formatCurrency(summary.total_income, summary.account_currency || "CAD")}
            color="green"
          />
          <MiniStat
            label={`Transfers (${summary.account_currency || "CAD"})`}
            value={formatCurrency(summary.total_transfers, summary.account_currency || "CAD")}
            color="blue"
          />
        </div>
      )}

      {/* Actions Bar */}
      <div className="card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">
            <span className="text-white font-bold">{selectedCount}</span> of{" "}
            {transactions.length} selected
          </span>
          <button
            onClick={() => selectAll("expense")}
            className="text-xs text-amber-500 hover:text-amber-400"
          >
            Select Expenses
          </button>
          <button
            onClick={() => selectAll("income")}
            className="text-xs text-emerald-500 hover:text-emerald-400"
          >
            Select Income
          </button>
          <button
            onClick={deselectAll}
            className="text-xs text-slate-500 hover:text-slate-400"
          >
            Clear All
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-ghost text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={() => handleImport(false)}
            disabled={isProcessing || selectedCount === 0}
            className="btn-primary text-sm"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Import {selectedCount} Transactions
              </>
            )}
          </button>
          {duplicateWarning && (
            <button
              onClick={() => handleImport(true)}
              disabled={isProcessing || selectedCount === 0}
              className="text-sm px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold rounded-lg border border-amber-500/40 transition-all flex items-center gap-1.5"
              title="Delete existing records and re-import with corrected data"
            >
              <ArrowUpDown className="w-4 h-4" />
              Force Re-import
            </button>
          )}
        </div>
      </div>

      {/* Transaction List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="p-3 text-left text-xs font-medium text-slate-500 w-10"></th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Date
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Vendor / Description
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Type
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Category
                </th>
                <th className="p-3 text-right text-xs font-medium text-slate-500">
                  Amount ({summary?.account_currency || "CAD"})
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr
                  key={tx.index}
                  onClick={() => toggleTransaction(tx.index)}
                  className={cn(
                    "border-b border-slate-800/50 cursor-pointer transition-colors",
                    tx.selected
                      ? "bg-amber-500/5 hover:bg-amber-500/10"
                      : "hover:bg-slate-800/50 opacity-50"
                  )}
                >
                  <td className="p-3">
                    <div
                      className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                        tx.selected
                          ? "border-amber-500 bg-amber-500"
                          : "border-slate-600"
                      )}
                    >
                      {tx.selected && (
                        <Check className="w-3 h-3 text-slate-950" />
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-sm text-slate-300 whitespace-nowrap">
                    {tx.transaction_date}
                  </td>
                  <td className="p-3">
                    <p className="text-sm font-medium text-white">
                      {tx.vendor_name || tx.description1}
                    </p>
                    <p className="text-xs text-slate-500 truncate max-w-[200px]">
                      {tx.description2}
                    </p>
                  </td>
                  <td className="p-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        tx.type === "expense"
                          ? "bg-red-500/10 text-red-400"
                          : tx.type === "income"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : tx.type === "transfer"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-orange-500/10 text-orange-400"
                      )}
                    >
                      {tx.type === "expense"
                        ? "Expense"
                        : tx.type === "income"
                        ? "Income"
                        : tx.type === "transfer"
                        ? "Transfer"
                        : "Owner Draw"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs"
                      style={{
                        backgroundColor: `${
                          categoryColors[tx.category] || "#6B7280"
                        }15`,
                        color: categoryColors[tx.category] || "#6B7280",
                      }}
                    >
                      {categoryLabels[tx.category] || tx.category}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {(() => {
                      const amt = tx.amount_cad ?? tx.amount_usd ?? 0;
                      const cur = tx.amount_cad != null && tx.amount_cad !== 0 ? "CAD" : tx.amount_usd != null && tx.amount_usd !== 0 ? "USD" : "CAD";
                      return (
                        <span
                          className={cn(
                            "text-sm font-bold",
                            amt > 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          )}
                        >
                          {formatCurrency(amt, cur)}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =============================================
// FACTORING IMPORT SECTION
// =============================================

function FactoringImportSection() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<ImportStep>("upload");
  const [isProcessing, setIsProcessing] = useState(false);
  const [reportData, setReportData] = useState<FactoringReportData | null>(
    null
  );
  const [entries, setEntries] = useState<FactoringEntry[]>([]);
  const [importResult, setImportResult] = useState<any>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pdfContentRef, setPdfContentRef] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }

    setIsProcessing(true);
    setDuplicateWarning(null);
    toast.loading("Checking for duplicates...", { id: "factoring-parse" });

    try {
      // Read file content for hashing
      const buffer = await file.arrayBuffer();
      const base64Content = btoa(
        new Uint8Array(buffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      setPdfContentRef(base64Content);
      setUploadedFileName(file.name);

      // 1. Check file-level duplicate
      const fileCheck = await duplicateCheckApi.checkFileHash(
        base64Content,
        "factoring_pdf"
      );
      if (fileCheck.isDuplicate) {
        const importDate = fileCheck.importedAt
          ? fileCheck.importedAt.toLocaleDateString("en-CA")
          : "unknown date";
        setDuplicateWarning(
          `This exact PDF file was already imported on ${importDate}. Duplicate entries will be automatically skipped.`
        );
      }

      // 2. Parse PDF with AI
      toast.loading("AI is reading the factoring report...", {
        id: "factoring-parse",
      });
      const result = await factoringApi.parsePDF(file);
      setReportData(result);

      // Mark fee entries as selected by default
      const withSelection = result.entries.map((entry) => ({
        ...entry,
        selected: entry.type === "fee" || entry.category === "factoring_fees",
      }));

      setEntries(withSelection);
      setStep("review");
      toast.success(
        `Parsed ${result.report_type.replace(/_/g, " ")} - ${result.entries.length} entries found`,
        { id: "factoring-parse" }
      );
    } catch (error: any) {
      toast.error(error.message || "Failed to parse report", {
        id: "factoring-parse",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleEntry = (idx: number) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, selected: !e.selected } : e))
    );
  };

  const handleImport = async (forceReimport = false) => {
    const selected = entries.filter((e) => e.selected);
    if (selected.length === 0) {
      toast.error("Please select at least one entry to import");
      return;
    }

    setIsProcessing(true);
    toast.loading(
      forceReimport
        ? `Force re-importing ${selected.length} entries...`
        : `Importing ${selected.length} entries...`,
      { id: "factoring-import" }
    );

    try {
      // For USD reports, fetch the actual Bank of Canada exchange rate
      let exchangeRate = 1.0;
      if (reportData?.currency === "USD") {
        toast.loading("Fetching Bank of Canada exchange rate...", {
          id: "factoring-import",
        });
        try {
          // Use the date range start or the first entry's date for the rate
          const rateDate = reportData.date_range?.start
            ? new Date(reportData.date_range.start)
            : selected[0]?.date
            ? new Date(selected[0].date)
            : new Date();
          exchangeRate = await revenueApi.fetchExchangeRate(rateDate);
        } catch {
          exchangeRate = 1.40; // Fallback if BoC API fails
          console.warn("Failed to fetch BoC rate, using fallback 1.40");
        }
        toast.loading(`Importing with rate: 1 USD = ${exchangeRate.toFixed(4)} CAD...`, {
          id: "factoring-import",
        });
      }

      const result = await factoringApi.importEntries(
        selected,
        reportData?.currency || "CAD",
        exchangeRate,
        forceReimport
      );

      setImportResult(result);
      setStep("done");

      // Register file hash after successful import
      if (pdfContentRef) {
        await duplicateCheckApi.registerFileImport(
          pdfContentRef,
          "factoring_pdf",
          {
            filename: uploadedFileName || "unknown.pdf",
            records_count: result.expenses_created,
          }
        );
      }

      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });

      const fExtraMsgs: string[] = [];
      if (result.replaced > 0) fExtraMsgs.push(`${result.replaced} corrected`);
      if (result.duplicates_skipped > 0) fExtraMsgs.push(`${result.duplicates_skipped} duplicates skipped`);
      const fExtra = fExtraMsgs.length > 0 ? ` (${fExtraMsgs.join(", ")})` : "";
      toast.success(
        `Imported ${result.expenses_created} factoring expenses${fExtra}`,
        { id: "factoring-import" }
      );
    } catch (error: any) {
      toast.error(error.message || "Import failed", {
        id: "factoring-import",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setReportData(null);
    setEntries([]);
    setImportResult(null);
    setDuplicateWarning(null);
    setPdfContentRef(null);
    setUploadedFileName(null);
  };

  if (step === "upload") {
    return (
      <div className="card p-8">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Upload J D Factors Report
          </h3>
          <p className="text-slate-400 text-sm mb-6">
            Upload Recourse Reports, Reserve Reports, or Trend Analysis PDFs.
            <br />
            AI will extract fees, purchases, and collections automatically.
          </p>

          <label className="btn-primary inline-flex cursor-pointer">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isProcessing}
            />
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Select PDF Report
              </>
            )}
          </label>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-slate-800/50 text-left">
              <h4 className="text-sm font-medium text-white mb-1">
                Recourse Report
              </h4>
              <p className="text-xs text-slate-400">
                Invoices returned by factor
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/50 text-left">
              <h4 className="text-sm font-medium text-white mb-1">
                Reserve Report
              </h4>
              <p className="text-xs text-slate-400">
                Account activity & fees
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/50 text-left">
              <h4 className="text-sm font-medium text-white mb-1">
                Trend Analysis
              </h4>
              <p className="text-xs text-slate-400">
                Monthly summary & totals
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="card p-8 text-center">
        <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-white mb-2">
          Import Complete!
        </h3>
        <div className="space-y-2 mb-6">
          {importResult?.expenses_created > 0 && (
            <p className="text-slate-300">
              <span className="text-red-400 font-bold">
                {importResult.expenses_created}
              </span>{" "}
              factoring expenses created
            </p>
          )}
          {importResult?.skipped > 0 && (
            <p className="text-slate-500">
              {importResult.skipped} entries skipped (non-fee items)
            </p>
          )}
          {importResult?.replaced > 0 && (
            <div className="flex items-center justify-center gap-2 text-blue-400">
              <ArrowUpDown className="w-4 h-4" />
              <p className="text-sm">
                <span className="font-bold">{importResult.replaced}</span>{" "}
                bad records corrected and re-imported
              </p>
            </div>
          )}
          {importResult?.duplicates_skipped > 0 && (
            <div className="flex items-center justify-center gap-2 text-amber-400">
              <ShieldAlert className="w-4 h-4" />
              <p className="text-sm">
                <span className="font-bold">{importResult.duplicates_skipped}</span>{" "}
                duplicate entries detected and skipped
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-3">
          <button onClick={reset} className="btn-primary">
            Import Another Report
          </button>
          {importResult?.duplicates_skipped > 0 && importResult?.expenses_created === 0 && (
            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl max-w-md">
              <p className="text-sm text-amber-300 mb-3">
                All entries were skipped as duplicates. If the previous import had errors, you can force re-import to replace them.
              </p>
              <button
                onClick={() => {
                  setStep("review");
                  setImportResult(null);
                }}
                className="w-full px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold rounded-lg border border-amber-500/40 transition-all flex items-center justify-center gap-2"
              >
                <ArrowUpDown className="w-4 h-4" />
                Go Back &amp; Force Re-import
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Review step
  const feeEntries = entries.filter(
    (e) => e.type === "fee" || e.category === "factoring_fees"
  );
  const selectedCount = entries.filter((e) => e.selected).length;

  return (
    <div className="space-y-6">
      {/* Duplicate Warning */}
      {duplicateWarning && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              Duplicate File Detected
            </p>
            <p className="text-xs text-amber-500/70 mt-1">
              {duplicateWarning}
            </p>
          </div>
        </motion.div>
      )}

      {/* Report Info */}
      {reportData && (
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">
                {reportData.report_type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </h3>
              <p className="text-sm text-slate-400">
                J D Factors | {reportData.currency} Account ({reportData.client_id})
              </p>
            </div>
            <div className="flex gap-4">
              <div className="text-right">
                <p className="text-xs text-slate-500">Total Fees</p>
                <p className="text-lg font-bold text-red-400">
                  {formatCurrency(
                    reportData.totals.total_fees,
                    reportData.currency
                  )}
                </p>
              </div>
              {reportData.totals.total_purchases > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-500">Total Purchases</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatCurrency(
                      reportData.totals.total_purchases,
                      reportData.currency
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Actions Bar */}
      <div className="card p-4 flex items-center justify-between">
        <span className="text-sm text-slate-400">
          <span className="text-white font-bold">{selectedCount}</span> of{" "}
          {entries.length} entries selected for import
        </span>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-ghost text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={() => handleImport(false)}
            disabled={isProcessing || selectedCount === 0}
            className="btn-primary text-sm"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Import {selectedCount} Entries
              </>
            )}
          </button>
          {duplicateWarning && (
            <button
              onClick={() => handleImport(true)}
              disabled={isProcessing || selectedCount === 0}
              className="text-sm px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold rounded-lg border border-amber-500/40 transition-all flex items-center gap-1.5"
              title="Delete existing records and re-import with corrected data"
            >
              <ArrowUpDown className="w-4 h-4" />
              Force Re-import
            </button>
          )}
        </div>
      </div>

      {/* Entries List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="p-3 text-left text-xs font-medium text-slate-500 w-10"></th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Date
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Description
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Type
                </th>
                <th className="p-3 text-left text-xs font-medium text-slate-500">
                  Reference
                </th>
                <th className="p-3 text-right text-xs font-medium text-slate-500">
                  Amount ({reportData?.currency})
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr
                  key={idx}
                  onClick={() => toggleEntry(idx)}
                  className={cn(
                    "border-b border-slate-800/50 cursor-pointer transition-colors",
                    entry.selected
                      ? "bg-amber-500/5 hover:bg-amber-500/10"
                      : "hover:bg-slate-800/50 opacity-50"
                  )}
                >
                  <td className="p-3">
                    <div
                      className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                        entry.selected
                          ? "border-amber-500 bg-amber-500"
                          : "border-slate-600"
                      )}
                    >
                      {entry.selected && (
                        <Check className="w-3 h-3 text-slate-950" />
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-sm text-slate-300 whitespace-nowrap">
                    {entry.date || "-"}
                  </td>
                  <td className="p-3">
                    <p className="text-sm font-medium text-white">
                      {entry.description}
                    </p>
                    {entry.debtor_name && (
                      <p className="text-xs text-slate-500">
                        {entry.debtor_name}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        entry.type === "fee"
                          ? "bg-red-500/10 text-red-400"
                          : entry.type === "purchase"
                          ? "bg-blue-500/10 text-blue-400"
                          : entry.type === "collection"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : entry.type === "recourse"
                          ? "bg-orange-500/10 text-orange-400"
                          : "bg-purple-500/10 text-purple-400"
                      )}
                    >
                      {entry.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-slate-400">
                    {entry.reference || "-"}
                  </td>
                  <td className="p-3 text-right">
                    <span
                      className={cn(
                        "text-sm font-bold",
                        entry.type === "fee" || entry.type === "recourse"
                          ? "text-red-400"
                          : "text-emerald-400"
                      )}
                    >
                      {entry.amount > 0
                        ? formatCurrency(entry.amount, reportData?.currency)
                        : "-"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =============================================
// SHARED COMPONENTS
// =============================================

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "slate" | "red" | "green" | "blue";
}) {
  const colorClasses = {
    slate: "text-slate-300",
    red: "text-red-400",
    green: "text-emerald-400",
    blue: "text-blue-400",
  };

  return (
    <div className="card p-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={cn("text-lg font-bold", colorClasses[color])}>{value}</p>
    </div>
  );
}
