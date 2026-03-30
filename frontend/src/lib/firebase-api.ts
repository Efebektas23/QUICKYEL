import { db, storage, ensureAuth } from "./firebase";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import * as XLSX from "xlsx";
import { fetchJsonWithRetry } from "./fetch-with-retry";
import {
  getTotalCCAForYear,
  getAdjustedCost,
  generateUCCSchedule,
  getCCAForYear,
  getUCCBalance,
  detectAssetCandidate,
  type Asset as CCAAsset,
  type AssetCategory as CCAAssetCategory,
  type AssetStatus as CCAAssetStatus,
  type UCCScheduleEntry,
} from "./cca-engine";
import {
  computeBcItcAutoFieldsFromGross,
  expenseHasManualOrParsedTax,
  getEffectiveRecoverableItcCad,
  getItcSourceLabel,
  getNetExpenseCad,
  mergeBcItcForCategoryChange,
} from "./bc-expense-tax";

// Collection references
const EXPENSES_COLLECTION = "expenses";
const CARDS_COLLECTION = "cards";
const REVENUE_COLLECTION = "revenue";
const IMPORT_HASHES_COLLECTION = "import_hashes";

// Types
export interface Expense {
  id?: string;
  vendor_name: string | null;
  transaction_date: Date | null;
  category: string;
  jurisdiction: string;
  original_amount: number | null;
  original_currency: string;
  currency?: string;  // Alias for original_currency
  tax_amount: number;
  // Tax amounts stored separately for accurate reporting
  gst_amount?: number;  // GST only (5%) - Federal tax, ITC recoverable
  hst_amount?: number;  // HST only (13-15%) - Harmonized tax, ITC recoverable
  pst_amount?: number;  // PST only (6-10%) - Provincial tax, NOT recoverable
  /** True when gst_amount was system-estimated from BC category rules (bank import / no receipt). */
  gst_itc_estimated?: boolean;
  exchange_rate: number;
  cad_amount: number | null;
  card_last_4: string | null;
  invoice_number: string | null;  // Unique transaction/invoice/auth identifier from receipt
  payment_source: string;
  receipt_image_url: string | null;
  receipt_image_urls?: string[];  // Multiple images support
  raw_ocr_text: string | null;
  is_verified: boolean;
  processing_status: string;
  error_message: string | null;
  notes: string | null;
  entry_type?: "ocr" | "manual" | "bank_import" | "factoring_import";
  proof_image_url?: string | null;  // Bank screenshot or other proof for manual entries
  // Bank import linking
  bank_linked?: boolean;
  bank_import_date?: Date;
  bank_description?: string;
  bank_statement_date?: string;
  bank_match_score?: number;
  bank_match_reason?: string;
  import_fingerprint?: string;
  // Receipt linking (when receipt uploaded after bank import)
  receipt_linked?: boolean;
  receipt_linked_date?: Date;
  created_at: Date;
  updated_at: Date;
  /** True when this row was converted to a balance-sheet asset (CCA); exclude from P&L operating expenses. */
  reclassified_to_asset?: boolean;
}

/** Operating-expense totals should ignore rows moved to Assets / CCA. */
export function isExpenseReclassifiedToAsset(
  e: Pick<Expense, "notes" | "reclassified_to_asset">,
): boolean {
  if (e.reclassified_to_asset === true) return true;
  const n = e.notes || "";
  return n.includes("[RECLASSIFIED TO ASSET]");
}

/** Personel — excluded from P&L totals, dashboard metrics, and CSV/XLSX (still listed on Expenses). */
export const EXCLUDED_FROM_BUSINESS_PL_CATEGORY = "personal";

export function isExcludedFromBusinessPl(e: Pick<Expense, "category">): boolean {
  return (e.category || "") === EXCLUDED_FROM_BUSINESS_PL_CATEGORY;
}

/** Set by assetsApi init — avoids forward reference when exportApi.getSummary lists assets for CCA. */
let listAssetsForSummary: (() => Promise<CCAAsset[]>) | null = null;

function fullCalendarYearFromRange(
  start?: string,
  end?: string,
): number | null {
  if (!start || !end) return null;
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  const y = s.getFullYear();
  if (y !== e.getFullYear()) return null;
  if (s.getMonth() !== 0 || s.getDate() !== 1) return null;
  if (e.getMonth() !== 11 || e.getDate() !== 31) return null;
  return y;
}

/** High-level data source for audit filters (maps to entry_type). */
export type ExpenseSourceKind = "bank" | "receipt" | "manual";

export type ExpenseMatchingStatus = "matched" | "unmatched" | "potential_duplicate";

export interface CategoryAuditTransaction {
  id: string;
  date: string | null;
  vendor: string | null;
  description: string;
  /** Gross CAD (bank / receipt total). */
  amount_cad: number;
  /** Net of recoverable ITC (BC rules). */
  amount_net_cad: number;
  source_kind: ExpenseSourceKind;
  matching_status: ExpenseMatchingStatus;
  entry_type: string;
  expense: Expense;
  receipt_url: string | null;
  bank_description: string | null;
  bank_statement_date: string | null;
  import_fingerprint: string | null;
}

export interface CategoryAuditResult {
  category: string;
  transactions: CategoryAuditTransaction[];
  /** Sum of gross CAD (bank totals). */
  total_cad: number;
  /** Sum of net expense (gross − ITC); reconciles to dashboard category totals. */
  total_net_cad: number;
  count: number;
  reconciles_with_summary: boolean;
  summary_delta_cad: number;
  stats: {
    average_cad: number;
    largest: { id: string; amount_cad: number; vendor: string | null } | null;
    /** Per month net CAD (aligned with dashboard). */
    monthly_trend: { month: string; label: string; total_cad: number; count: number }[];
  };
}

function resolvedEntryType(e: Expense): string {
  if (e.entry_type) return e.entry_type;
  if (e.notes?.includes("[Bank Import]")) return "bank_import";
  return "manual";
}

export function expenseSourceKind(e: Expense): ExpenseSourceKind {
  const et = resolvedEntryType(e);
  if (et === "bank_import" || et === "factoring_import") return "bank";
  if (et === "ocr") return "receipt";
  return "manual";
}

function hasReceiptAttachment(e: Expense): boolean {
  return !!(
    e.receipt_image_url ||
    (e.receipt_image_urls && e.receipt_image_urls.length > 0)
  );
}

export function expenseMatchingStatus(
  e: Expense,
  duplicateIds: Set<string>
): ExpenseMatchingStatus {
  if (e.id && duplicateIds.has(e.id)) return "potential_duplicate";
  const hasReceipt = hasReceiptAttachment(e);
  const et = resolvedEntryType(e);
  if (e.bank_linked && hasReceipt) return "matched";
  if ((et === "bank_import" || et === "factoring_import") && (hasReceipt || e.receipt_linked))
    return "matched";
  if (et === "ocr" && e.bank_linked) return "matched";
  return "unmatched";
}

function expenseDateKeyForDedup(exp: Expense): string {
  if (!exp.transaction_date) return "unknown";
  const t: unknown = exp.transaction_date;
  if (t instanceof Date) {
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const day = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  try {
    const d = new Date(t as string);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return "unknown";
  }
}

function findPotentialDuplicateIds(expenses: Expense[]): Set<string> {
  const map = new Map<string, string[]>();
  for (const e of expenses) {
    if (!e.id) continue;
    const amt = Math.round((e.cad_amount || 0) * 100);
    const d = expenseDateKeyForDedup(e);
    const v = (e.vendor_name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 14);
    const key = `${amt}|${d}|${v}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e.id);
  }
  const dups = new Set<string>();
  for (const ids of Array.from(map.values())) {
    if (ids.length > 1)
      ids.forEach((id: string) => {
        dups.add(id);
      });
  }
  return dups;
}

export interface Card {
  id?: string;
  last_four: string;
  card_name: string;
  is_company_card: boolean;
  currency?: "CAD" | "USD";
  created_at: Date;
}

export interface Revenue {
  id?: string;
  broker_name: string;
  load_id: string | null;
  date: Date;
  // Multi-currency support
  amount_original: number;        // Original amount from document
  currency: "USD" | "CAD";        // Original currency
  exchange_rate: number;          // Bank of Canada rate (1.0 if CAD)
  amount_cad: number;             // Final CAD amount
  // Legacy fields for backward compatibility
  amount_usd?: number;
  // Document & status
  image_url: string | null;
  raw_ocr_text?: string | null;
  status: "verified" | "pending";
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// Helper to convert Firestore timestamp/string to Date (timezone-safe)
const toDate = (timestamp: any): Date => {
  if (!timestamp) return new Date();

  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  // Handle ISO string (YYYY-MM-DD) - parse as local date to avoid timezone shift
  if (typeof timestamp === 'string' && timestamp.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = timestamp.split('-').map(Number);
    return new Date(year, month - 1, day); // Month is 0-indexed
  }
  return new Date(timestamp);
};

// Helper to format date as ISO string (YYYY-MM-DD) for storage
const toISODateString = (date: Date | string | null): string | null => {
  if (!date) return null;

  if (typeof date === 'string') {
    // Already a string, validate format
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return date;
    }
    date = new Date(date);
  }

  // Format as YYYY-MM-DD using local date parts (no timezone shift)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ============ STORAGE ============

export const storageApi = {
  /**
   * Upload receipt image to Firebase Storage
   */
  uploadReceipt: async (file: File): Promise<string> => {
    // Ensure authenticated before upload
    await ensureAuth();

    const timestamp = Date.now();
    const fileName = `receipts/${timestamp}_${file.name}`;
    const storageRef = ref(storage, fileName);

    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    return downloadURL;
  },

  /**
   * Delete receipt from Firebase Storage
   */
  deleteReceipt: async (url: string): Promise<void> => {
    try {
      const storageRef = ref(storage, url);
      await deleteObject(storageRef);
    } catch (error) {
      console.error("Error deleting receipt:", error);
    }
  },
};

// ============ DUPLICATE RECEIPT DETECTION ============

/**
 * Compute SHA-256 hash of file content for duplicate receipt detection.
 * Same file → same hash (deterministic).
 */
async function computeReceiptHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'receipt_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============ EXPENSES ============

export const expensesApi = {
  /**
   * Create a new expense
   */
  create: async (expense: Partial<Expense>): Promise<string> => {
    await ensureAuth();
    const now = new Date();
    const docRef = await addDoc(collection(db, EXPENSES_COLLECTION), {
      ...expense,
      created_at: Timestamp.fromDate(now),
      updated_at: Timestamp.fromDate(now),
    });
    return docRef.id;
  },

  /**
   * Get expense by ID
   */
  get: async (id: string): Promise<Expense | null> => {
    await ensureAuth();
    const docRef = doc(db, EXPENSES_COLLECTION, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      transaction_date: data.transaction_date ? toDate(data.transaction_date) : null,
      created_at: toDate(data.created_at),
      updated_at: toDate(data.updated_at),
    } as Expense;
  },

  /**
   * List all expenses
   */
  list: async (params?: {
    per_page?: number;
    page?: number;
    category?: string;
    start_date?: string;
    end_date?: string;
    is_verified?: boolean;
  }): Promise<{ expenses: Expense[]; total: number }> => {
    await ensureAuth();
    const q = query(
      collection(db, EXPENSES_COLLECTION),
      orderBy("created_at", "desc"),
      limit(params?.per_page || 50)
    );

    const querySnapshot = await getDocs(q);
    const expenses: Expense[] = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      expenses.push({
        id: docSnap.id,
        ...data,
        transaction_date: data.transaction_date ? toDate(data.transaction_date) : null,
        created_at: toDate(data.created_at),
        updated_at: toDate(data.updated_at),
      } as Expense);
    });

    return { expenses, total: expenses.length };
  },

  /**
   * Verified expenses for a category with audit fields (matches dashboard summary logic).
   * Uses the same verified + date window as exportApi.getSummary for reconciliation.
   */
  listByCategoryAudit: async (params: {
    category: string;
    start_date?: string | null;
    end_date?: string | null;
    /** Filter: bank | receipt | manual (entry_type–derived) */
    source_kind?: ExpenseSourceKind | "all";
    /** Case-insensitive match on vendor name or notes (truck / driver tags, etc.) */
    truck_driver_query?: string;
    /** Category total (net of recoverable ITC) from summary — reconciles to visible net total */
    expected_total_cad?: number;
  }): Promise<CategoryAuditResult> => {
    const { expenses: raw } = await expensesApi.list({ per_page: 5000 });
    let list = raw.filter((e) => e.is_verified);

    if (params.start_date) {
      const start = new Date(params.start_date);
      list = list.filter(
        (e) => e.transaction_date && new Date(e.transaction_date) >= start
      );
    }
    if (params.end_date) {
      const end = new Date(params.end_date);
      end.setHours(23, 59, 59, 999);
      list = list.filter(
        (e) => e.transaction_date && new Date(e.transaction_date) <= end
      );
    }

    const cat = params.category;
    list = list.filter((e) => (e.category || "uncategorized") === cat);
    list = list.filter((e) => !isExpenseReclassifiedToAsset(e));

    const q = (params.truck_driver_query || "").trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const hay = `${e.vendor_name || ""} ${e.notes || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const sk = params.source_kind;
    if (sk && sk !== "all") {
      list = list.filter((e) => expenseSourceKind(e) === sk);
    }

    const duplicateIds = findPotentialDuplicateIds(list);

    const transactions: CategoryAuditTransaction[] = list.map((e) => {
      const dateStr = e.transaction_date
        ? toISODateString(e.transaction_date)
        : null;
      const desc =
        (e.notes || "").trim() ||
        (e.bank_description || "").trim() ||
        (e.vendor_name || "").trim() ||
        "—";
      const gross = e.cad_amount || 0;
      return {
        id: e.id!,
        date: dateStr,
        vendor: e.vendor_name,
        description: desc,
        amount_cad: gross,
        amount_net_cad: getNetExpenseCad(e),
        source_kind: expenseSourceKind(e),
        matching_status: expenseMatchingStatus(e, duplicateIds),
        entry_type: resolvedEntryType(e),
        expense: e,
        receipt_url: e.receipt_image_url,
        bank_description: e.bank_description ?? null,
        bank_statement_date: e.bank_statement_date ?? null,
        import_fingerprint: e.import_fingerprint ?? null,
      };
    });

    transactions.sort((a, b) => {
      const ta = a.date || "";
      const tb = b.date || "";
      return tb.localeCompare(ta);
    });

    const total_cad = Math.round(
      transactions.reduce((s, t) => s + t.amount_cad, 0) * 100
    ) / 100;
    const total_net_cad = Math.round(
      transactions.reduce((s, t) => s + t.amount_net_cad, 0) * 100
    ) / 100;
    const count = transactions.length;

    const exp = params.expected_total_cad;
    const summary_delta_cad =
      exp !== undefined ? Math.round((total_net_cad - exp) * 100) / 100 : 0;
    const reconciles_with_summary =
      exp === undefined || Math.abs(total_net_cad - exp) < 0.02;

    let largest: CategoryAuditResult["stats"]["largest"] = null;
    for (const t of transactions) {
      if (!largest || t.amount_cad > largest.amount_cad) {
        largest = { id: t.id, amount_cad: t.amount_cad, vendor: t.vendor };
      }
    }

    const monthMap = new Map<string, { total_cad: number; count: number }>();
    for (const t of transactions) {
      const key = t.date ? t.date.slice(0, 7) : "unknown";
      if (!monthMap.has(key))
        monthMap.set(key, { total_cad: 0, count: 0 });
      const m = monthMap.get(key)!;
      m.total_cad += t.amount_net_cad;
      m.count += 1;
    }
    const monthly_trend = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        label: month === "unknown" ? "No date" : month,
        total_cad: Math.round(v.total_cad * 100) / 100,
        count: v.count,
      }));

    const average_cad =
      count > 0 ? Math.round((total_net_cad / count) * 100) / 100 : 0;

    return {
      category: cat,
      transactions,
      total_cad,
      total_net_cad,
      count,
      reconciles_with_summary,
      summary_delta_cad,
      stats: { average_cad, largest, monthly_trend },
    };
  },

  bulkUpdateCategory: async (
    ids: string[],
    category: string
  ): Promise<void> => {
    if (ids.length === 0) return;
    await ensureAuth();
    const now = new Date();
    const CHUNK = 400;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const id of slice) {
        const ref = doc(db, EXPENSES_COLLECTION, id);
        const snap = await getDoc(ref);
        if (!snap.exists()) continue;
        const data = snap.data();
        const existing = {
          id,
          ...data,
          transaction_date: data.transaction_date ? toDate(data.transaction_date) : null,
          created_at: toDate(data.created_at),
          updated_at: toDate(data.updated_at),
        } as Expense;
        const mergedPatch = mergeBcItcForCategoryChange(existing, category);
        batch.update(ref, {
          ...mergedPatch,
          updated_at: Timestamp.fromDate(now),
        });
      }
      await batch.commit();
    }
  },

  /**
   * Update expense
   */
  update: async (id: string, data: Partial<Expense>): Promise<void> => {
    await ensureAuth();
    const docRef = doc(db, EXPENSES_COLLECTION, id);
    await updateDoc(docRef, {
      ...data,
      updated_at: Timestamp.fromDate(new Date()),
    });
  },

  /**
   * Change category and refresh BC ITC estimate when the row is still system-estimated or has no manual tax.
   */
  updateCategoryWithItc: async (id: string, category: string): Promise<void> => {
    const existing = await expensesApi.get(id);
    if (!existing) throw new Error("Expense not found");
    const patch = mergeBcItcForCategoryChange(existing, category);
    await expensesApi.update(id, patch as Partial<Expense>);
  },

  /**
   * Verify expense; applies BC ITC estimate when taxes are still blank (bank imports).
   */
  verify: async (id: string): Promise<void> => {
    await ensureAuth();
    const docRef = doc(db, EXPENSES_COLLECTION, id);
    const exp = await expensesApi.get(id);
    const now = Timestamp.fromDate(new Date());
    const patch: Record<string, unknown> = {
      is_verified: true,
      updated_at: now,
    };
    if (exp) {
      if (exp.gst_itc_estimated === false) {
        /* keep taxes — user or receipt is authoritative */
      } else if (exp.gst_itc_estimated === true) {
        const itc = computeBcItcAutoFieldsFromGross(
          exp.category,
          exp.cad_amount ?? 0,
          exp.jurisdiction,
          exp.original_currency || exp.currency,
        );
        if (itc) Object.assign(patch, itc);
      } else if (!expenseHasManualOrParsedTax(exp)) {
        const itc = computeBcItcAutoFieldsFromGross(
          exp.category,
          exp.cad_amount ?? 0,
          exp.jurisdiction,
          exp.original_currency || exp.currency,
        );
        if (itc) Object.assign(patch, itc);
      }
    }
    // Firestore UpdateData is stricter than our dynamic patch shape
    await updateDoc(docRef, patch as any);
  },

  /**
   * Delete expense
   */
  delete: async (id: string): Promise<void> => {
    // First get the expense to delete the image
    const expense = await expensesApi.get(id);
    if (expense?.receipt_image_url) {
      await storageApi.deleteReceipt(expense.receipt_image_url);
    }

    // Clean up any receipt hashes associated with this expense
    // so the same receipt can be re-uploaded later
    try {
      const hashQuery = query(
        collection(db, IMPORT_HASHES_COLLECTION),
        where("expense_id", "==", id)
      );
      const hashSnaps = await getDocs(hashQuery);
      for (const hashDoc of hashSnaps.docs) {
        await deleteDoc(hashDoc.ref);
      }
    } catch (err) {
      console.warn("Could not clean up receipt hashes:", err);
    }

    const docRef = doc(db, EXPENSES_COLLECTION, id);
    await deleteDoc(docRef);
  },

  /**
   * Upload multiple receipt images and process with backend AI
   * For long receipts that need multiple photos
   * @param skipDuplicateCheck - if true, skip all duplicate detection (user override)
   */
  uploadMultiple: async (files: File[], skipDuplicateCheck = false): Promise<Expense> => {
    console.log(`📤 Starting upload for ${files.length} file(s)${skipDuplicateCheck ? " (duplicate check skipped)" : ""}`);

    // 0. Check for exact file duplicate (same image file uploaded before)
    const primaryFileHash = await computeReceiptHash(files[0]);
    if (!skipDuplicateCheck) {
      console.log("🔍 Checking for duplicate file...");
      const hashDocSnap = await getDoc(doc(db, IMPORT_HASHES_COLLECTION, primaryFileHash));
      if (hashDocSnap.exists()) {
        // Verify the referenced expense still exists (it may have been deleted)
        const hashData = hashDocSnap.data();
        if (hashData?.expense_id) {
          const expenseDoc = await getDoc(doc(db, EXPENSES_COLLECTION, hashData.expense_id));
          if (!expenseDoc.exists()) {
            // Expense was deleted - clean up the orphaned hash and allow re-upload
            console.log("🧹 Cleaning up orphaned receipt hash (expense was deleted)");
            await deleteDoc(doc(db, IMPORT_HASHES_COLLECTION, primaryFileHash));
          } else {
            throw new Error(
              "DUPLICATE_RECEIPT: This exact receipt image has already been uploaded. Please check your expenses list.|||SIMILAR_RECORDS:[]"
            );
          }
        } else {
          throw new Error(
            "DUPLICATE_RECEIPT: This exact receipt image has already been uploaded. Please check your expenses list.|||SIMILAR_RECORDS:[]"
          );
        }
      }
    } else {
      // User overriding - clean up any existing hash for this file so we can re-register
      try { await deleteDoc(doc(db, IMPORT_HASHES_COLLECTION, primaryFileHash)); } catch { }
    }

    // 1. Upload all images to Firebase Storage
    const imageUrls: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`📤 Uploading image ${i + 1}/${files.length}: ${file.name}`);
        const url = await storageApi.uploadReceipt(file);
        imageUrls.push(url);
      }
      console.log("✅ All images uploaded:", imageUrls);
    } catch (storageError: any) {
      console.error("❌ Firebase Storage error:", storageError);
      throw new Error(`Firebase Storage hatası: ${storageError.message}`);
    }

    // 2. Create initial expense record in Firestore
    let expenseId: string;
    try {
      expenseId = await expensesApi.create({
        receipt_image_url: imageUrls[0], // Primary image
        receipt_image_urls: imageUrls,   // All images
        processing_status: "processing",
        is_verified: false,
        original_currency: "CAD",
        exchange_rate: 1.0,
        tax_amount: 0,
        gst_amount: 0,
        hst_amount: 0,
        pst_amount: 0,
        category: "uncategorized",
        jurisdiction: "unknown",
        payment_source: "unknown",
      });
      console.log("✅ Expense created in Firestore:", expenseId);
    } catch (firestoreError: any) {
      console.error("❌ Firestore error:", firestoreError);
      throw new Error(`Firestore hatası: ${firestoreError.message}`);
    }

    try {
      // 3. Send to backend for OCR + Gemini processing (with all image URLs)
      console.log("🤖 Sending to backend for processing...");
      // Use centralized API URL from runtime-config
      const { API_URL } = await import("./runtime-config");
      const result = await fetchJsonWithRetry<any>(
        `${API_URL}/api/process-receipt/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expense_id: expenseId,
            image_url: imageUrls[0],
            image_urls: imageUrls, // Send all URLs for multi-image processing
          }),
        }
      );
      console.log("✅ Backend processing complete:", result);

      // 3.5 Check for matching bank_import expense FIRST (reverse matching)
      // If the user already imported a bank CSV, find the matching transaction.
      // This MUST run before duplicate detection so bank matches aren't mistaken for duplicates.
      const parsedAmount = result.cad_amount || result.total_amount || 0;
      const parsedDateStr = result.transaction_date || "";
      const parsedVendor = (result.vendor_name || "").toLowerCase().trim();
      const receiptDate = result.transaction_date ? new Date(result.transaction_date) : null;

      if (parsedAmount > 0 && receiptDate) {
        console.log("🔍 Checking for matching bank import expense...");
        try {
          const bankExpQ = query(
            collection(db, EXPENSES_COLLECTION),
            where("entry_type", "==", "bank_import")
          );
          const bankExpSnap = await getDocs(bankExpQ);

          let bestMatchId = "";
          let bestMatchData: Record<string, any> = {};
          let bestMatchScore = 0;
          let bestMatchReason = "";

          for (const docSnap of bankExpSnap.docs) {
            const data = docSnap.data();
            // Skip already receipt-linked records
            if (data.receipt_linked || data.receipt_image_url) continue;

            const bankAmount = data.cad_amount || 0;
            const bankDate = data.transaction_date
              ? (typeof data.transaction_date === "string"
                ? new Date(data.transaction_date)
                : data.transaction_date.toDate?.() || new Date(data.transaction_date))
              : null;
            const bankVendor = (data.vendor_name || "").toLowerCase();

            // Amount check
            const amountDiff = Math.abs(parsedAmount - bankAmount);
            const amountPct = parsedAmount > 0 ? (amountDiff / parsedAmount) * 100 : 100;
            if (amountDiff >= 1.0 && amountPct >= 2) continue;

            // Date check
            if (!bankDate) continue;
            const daysDiff = Math.abs((receiptDate.getTime() - bankDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff > 7) continue;

            // Score
            let score = 0;
            const reasons: string[] = [];
            if (amountDiff < 0.02) { score += 50; reasons.push("exact amount"); }
            else if (amountDiff < 1.0) { score += 40; reasons.push("close amount"); }
            else { score += 25; reasons.push("similar amount"); }

            if (daysDiff < 1) { score += 30; reasons.push("same day"); }
            else if (daysDiff <= 3) { score += 20; reasons.push("date ±3 days"); }
            else { score += 10; reasons.push("date ±7 days"); }

            // Vendor match
            if (parsedVendor && bankVendor) {
              const rWords = parsedVendor.split(/[\s,.\-\/]+/).filter((w: string) => w.length > 2);
              const bWords = bankVendor.split(/[\s,.\-\/]+/).filter((w: string) => w.length > 2);
              if (parsedVendor === bankVendor) { score += 20; reasons.push("exact vendor"); }
              else if (rWords.some((rw: string) => bWords.some((bw: string) => bw.includes(rw) || rw.includes(bw)))) { score += 10; reasons.push("vendor partial"); }
            }

            if (score >= 60 && score > bestMatchScore) {
              bestMatchId = docSnap.id;
              bestMatchData = data;
              bestMatchScore = score;
              bestMatchReason = reasons.join(", ");
            }
          }

          if (bestMatchId) {
            console.log(`✅ Found matching bank expense (score: ${bestMatchScore}), linking receipt to it`);

            // Update the existing bank_import expense with receipt data
            await expensesApi.update(bestMatchId, {
              // Receipt visual archive
              receipt_image_url: imageUrls[0],
              receipt_image_urls: imageUrls,
              raw_ocr_text: result.raw_text,
              // Tax info from receipt (the real values from the actual receipt)
              tax_amount: result.tax_amount || 0,
              gst_amount: result.gst_amount || 0,
              hst_amount: result.hst_amount || 0,
              pst_amount: result.pst_amount || 0,
              gst_itc_estimated: false,
              // Update vendor/category if receipt has better info
              vendor_name: result.vendor_name || bestMatchData.vendor_name,
              category: result.category !== "uncategorized" ? result.category : bestMatchData.category,
              jurisdiction: result.jurisdiction !== "unknown" ? result.jurisdiction : bestMatchData.jurisdiction,
              card_last_4: result.card_last_4 || bestMatchData.card_last_4,
              // Link flags
              receipt_linked: true,
              receipt_linked_date: new Date(),
              bank_match_score: bestMatchScore,
              bank_match_reason: bestMatchReason,
              is_verified: false, // Needs user review
              processing_status: "completed",
            });

            // Delete the placeholder expense we created at step 2
            await deleteDoc(doc(db, EXPENSES_COLLECTION, expenseId));
            console.log(`🗑️ Deleted placeholder expense ${expenseId}, using bank record ${bestMatchId}`);

            // Register receipt file hash for future duplicate detection
            try {
              await setDoc(doc(db, IMPORT_HASHES_COLLECTION, primaryFileHash), {
                type: 'receipt', filename: files[0].name, expense_id: bestMatchId,
                imported_at: Timestamp.fromDate(new Date()),
              });
            } catch { }

            return (await expensesApi.get(bestMatchId))!;
          }
        } catch (matchErr) {
          console.warn("Bank matching check failed, continuing with new expense:", matchErr);
        }
      }

      // 4. Check for duplicate receipt (different photo of same receipt)
      // Uses a scoring system: amount + date is already strong evidence,
      // vendor match is a bonus. This catches camera re-takes of same receipt.
      // NOTE: This runs AFTER bank matching so bank transactions aren't false-positive duplicates.
      const parsedInvoiceNumber = (result.invoice_number || "").trim();
      const parsedCategory = (result.category || "").toLowerCase();
      const isFuelCategory = parsedCategory === "fuel";

      if (parsedAmount > 0 && !skipDuplicateCheck) {
        console.log("🔍 Checking for duplicate receipt data...");
        console.log(`   Parsed: vendor="${parsedVendor}" amount=${parsedAmount} date="${parsedDateStr}" invoice="${parsedInvoiceNumber}" category="${parsedCategory}"`);
        try {
          const allExpSnap = await getDocs(collection(db, EXPENSES_COLLECTION));

          // Collect ALL similar records for the duplicate preview panel
          interface SimilarRecord {
            id: string;
            vendor_name: string;
            amount: number;
            date: string;
            category: string;
            payment_source: string;
            card_last_4: string;
            notes: string;
            bank_description: string;
            entry_type: string;
            score: number;
            reasons: string[];
          }
          const similarRecords: SimilarRecord[] = [];
          let bestMatchDoc: { id: string; data: Record<string, any>; score: number } | null = null;

          for (const existingDoc of allExpSnap.docs) {
            if (existingDoc.id === expenseId) continue; // Skip our placeholder
            const data = existingDoc.data();

            // Only check expenses that have receipt images (uploaded via OCR/receipt)
            if (!data.receipt_image_url) continue;

            // Don't treat bank imports as duplicates — they're match candidates handled above
            if (data.entry_type === "bank_import") continue;

            const existingAmount = data.cad_amount || 0;
            const existingDateRaw = data.transaction_date;
            const existingDate = existingDateRaw
              ? (typeof existingDateRaw === "string"
                ? existingDateRaw.substring(0, 10) // Take YYYY-MM-DD part
                : "")
              : "";
            const existingVendor = (data.vendor_name || "").toLowerCase().trim();
            const existingInvoiceNumber = (data.invoice_number || "").trim();

            // ── Invoice number disambiguation ──
            // If BOTH receipts have a non-empty invoice/transaction number
            // and they DIFFER → these are definitely different transactions, skip.
            if (parsedInvoiceNumber && existingInvoiceNumber &&
              parsedInvoiceNumber !== existingInvoiceNumber) {
              continue; // Different invoice numbers = not a duplicate
            }

            // Score-based duplicate detection
            // Only exact amount counts - gas stations (Petro Canada, etc.) often have
            // many similar amounts; "within $1" caused too many false positives.
            let score = 0;
            const reasons: string[] = [];

            const amountDiff = Math.abs(parsedAmount - existingAmount);
            if (amountDiff < 0.05) {
              score += 50; // Exact amount required for duplicate
              reasons.push("exact amount");
            } else {
              continue; // Amount must match exactly - skip
            }

            // Date check: same date is strong evidence
            const parsedDateNorm = parsedDateStr.substring(0, 10); // YYYY-MM-DD
            if (existingDate && parsedDateNorm && existingDate === parsedDateNorm) {
              score += 40; // Same date
              reasons.push("same date");
            } else if (existingDate && parsedDateNorm) {
              // Check within 1 day (posting date vs transaction date)
              const d1 = new Date(existingDate);
              const d2 = new Date(parsedDateNorm);
              const daysDiff = Math.abs((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
              if (daysDiff <= 1) {
                score += 25;
                reasons.push("date ±1 day");
              }
            }

            // Vendor check: bonus points (reduced for fuel to avoid false positives
            // since refueling at the same station is routine for trucking)
            if (parsedVendor && existingVendor) {
              if (parsedVendor === existingVendor) {
                score += isFuelCategory ? 5 : 20;
                reasons.push(isFuelCategory ? "exact vendor (fuel)" : "exact vendor");
              } else {
                const rWords = parsedVendor.split(/[\s,.\-\/]+/).filter((w: string) => w.length > 2);
                const eWords = existingVendor.split(/[\s,.\-\/]+/).filter((w: string) => w.length > 2);
                const hasCommon = rWords.some((rw: string) =>
                  eWords.some((ew: string) => ew.includes(rw) || rw.includes(ew))
                );
                if (hasCommon) {
                  score += isFuelCategory ? 3 : 10;
                  reasons.push("vendor partial match");
                }
              }
            }

            // Same invoice number is strong confirmation of true duplicate
            if (parsedInvoiceNumber && existingInvoiceNumber &&
              parsedInvoiceNumber === existingInvoiceNumber) {
              score += 30;
              reasons.push("same invoice #");
            }

            // Threshold: For fuel merchants, require very high confidence (95)
            // since same-station same-day same-amount is normal for trucking.
            // For other merchants, 70 is sufficient (exact amount + same date = 90).
            const threshold = isFuelCategory ? 95 : 70;

            // Collect this as a similar record if it has a reasonable score (>= 50 means exact amount match)
            if (score >= 50) {
              similarRecords.push({
                id: existingDoc.id,
                vendor_name: data.vendor_name || "Unknown",
                amount: existingAmount,
                date: existingDate,
                category: data.category || "uncategorized",
                payment_source: data.payment_source || "",
                card_last_4: data.card_last_4 || "",
                notes: data.notes || "",
                bank_description: data.bank_description || "",
                entry_type: data.entry_type || "",
                score,
                reasons,
              });
            }

            if (score >= threshold && (!bestMatchDoc || score > bestMatchDoc.score)) {
              bestMatchDoc = { id: existingDoc.id, data, score };
            }
          }

          if (bestMatchDoc) {
            const matchData = bestMatchDoc.data;
            const matchAmount = matchData.cad_amount || 0;
            const matchDate = matchData.transaction_date
              ? (typeof matchData.transaction_date === "string" ? matchData.transaction_date.substring(0, 10) : "")
              : "";

            console.log(`⚠️ Duplicate receipt detected (score: ${bestMatchDoc.score})! Matches expense ${bestMatchDoc.id}: ${matchData.vendor_name} ${matchAmount.toFixed(2)} CAD`);

            // Clean up: delete uploaded images and placeholder expense
            for (const url of imageUrls) {
              try { await storageApi.deleteReceipt(url); } catch { }
            }
            await deleteDoc(doc(db, EXPENSES_COLLECTION, expenseId));

            // Sort similar records by score (highest first)
            similarRecords.sort((a, b) => b.score - a.score);

            // Encode similar records as JSON payload in the error message
            // Format: "DUPLICATE_RECEIPT: <message>|||SIMILAR_RECORDS:<json>"
            const similarRecordsJson = JSON.stringify(similarRecords.slice(0, 5)); // Max 5 records
            throw new Error(
              `DUPLICATE_RECEIPT: This receipt appears to have been uploaded before. ` +
              `Matching expense: ${matchData.vendor_name || "Unknown"} - ${matchAmount.toFixed(2)} CAD on ${matchDate}` +
              `|||SIMILAR_RECORDS:${similarRecordsJson}`
            );
          }
        } catch (dupErr: any) {
          if (dupErr.message?.startsWith("DUPLICATE_RECEIPT")) throw dupErr;
          console.warn("Duplicate check failed, continuing:", dupErr);
        }
      }

      // 5. No bank match found - update the new expense with parsed data
      await expensesApi.update(expenseId, {
        vendor_name: result.vendor_name,
        transaction_date: result.transaction_date || null,
        category: result.category || "uncategorized",
        jurisdiction: result.jurisdiction || "unknown",
        original_amount: result.total_amount,
        original_currency: result.currency || "CAD",
        tax_amount: result.tax_amount || 0,
        gst_amount: result.gst_amount || 0,
        hst_amount: result.hst_amount || 0,
        pst_amount: result.pst_amount || 0,
        gst_itc_estimated: false,
        exchange_rate: result.exchange_rate || 1.0,
        cad_amount: result.cad_amount || result.total_amount,
        card_last_4: result.card_last_4,
        invoice_number: result.invoice_number || null,
        raw_ocr_text: result.raw_text,
        processing_status: "completed",
        entry_type: "ocr",
      });

      // Register receipt file hash for future duplicate detection
      try {
        await setDoc(doc(db, IMPORT_HASHES_COLLECTION, primaryFileHash), {
          type: 'receipt', filename: files[0].name, expense_id: expenseId,
          imported_at: Timestamp.fromDate(new Date()),
        });
      } catch { }

      return (await expensesApi.get(expenseId))!;

    } catch (error: any) {
      console.error("❌ Processing error:", error);
      if (error.message?.startsWith("DUPLICATE_RECEIPT")) {
        // Cleanup already handled in the duplicate check, just re-throw
        throw error;
      }
      await expensesApi.update(expenseId, {
        processing_status: "error",
        error_message: error.message,
      });
      throw error;
    }
  },

  /**
   * Manually link a receipt expense to a bank_import expense.
   * Mirrors the auto-match flow (lines 486–526) but triggered by the user.
   *
   * @param receiptExpenseId - ID of the standalone receipt expense (entry_type: "ocr")
   * @param bankExpenseId - ID of the bank_import expense to link to
   * @returns The merged expense (bank_import doc with receipt data attached)
   */
  linkToBank: async (receiptExpenseId: string, bankExpenseId: string): Promise<Expense> => {
    console.log(`🔗 Manual link: receipt ${receiptExpenseId} → bank ${bankExpenseId}`);

    // 1. Fetch both expenses
    const receiptExp = await expensesApi.get(receiptExpenseId);
    const bankExp = await expensesApi.get(bankExpenseId);

    if (!receiptExp) throw new Error("Receipt expense not found");
    if (!bankExp) throw new Error("Bank transaction not found");

    // 2. Validate: receipt expense must have a receipt image
    if (!receiptExp.receipt_image_url) {
      throw new Error("The selected expense has no receipt image to link");
    }

    // 3. Validate: bank expense should be a bank_import
    if (bankExp.entry_type !== "bank_import") {
      throw new Error("The target expense is not a bank import transaction");
    }

    // 4. Validate: bank expense shouldn't already be linked
    if (bankExp.receipt_linked || bankExp.receipt_image_url) {
      throw new Error("This bank transaction already has a receipt linked");
    }

    // 5. Copy receipt data onto the bank_import expense (same as auto-match)
    await expensesApi.update(bankExpenseId, {
      // Receipt visual archive
      receipt_image_url: receiptExp.receipt_image_url,
      receipt_image_urls: receiptExp.receipt_image_urls || [receiptExp.receipt_image_url],
      raw_ocr_text: receiptExp.raw_ocr_text,
      // Tax info from receipt
      tax_amount: receiptExp.tax_amount || bankExp.tax_amount || 0,
      gst_amount: receiptExp.gst_amount || bankExp.gst_amount || 0,
      hst_amount: receiptExp.hst_amount || bankExp.hst_amount || 0,
      pst_amount: receiptExp.pst_amount || bankExp.pst_amount || 0,
      gst_itc_estimated: false,
      // Keep better vendor/category info
      vendor_name: receiptExp.vendor_name || bankExp.vendor_name,
      category: (receiptExp.category && receiptExp.category !== "uncategorized")
        ? receiptExp.category
        : bankExp.category,
      jurisdiction: (receiptExp.jurisdiction && receiptExp.jurisdiction !== "unknown")
        ? receiptExp.jurisdiction
        : bankExp.jurisdiction,
      card_last_4: receiptExp.card_last_4 || bankExp.card_last_4,
      // Link flags
      receipt_linked: true,
      receipt_linked_date: new Date(),
      bank_match_reason: "manual link",
      is_verified: false, // Needs user review
      processing_status: "completed",
    });

    // 6. Delete the standalone receipt expense
    await deleteDoc(doc(db, EXPENSES_COLLECTION, receiptExpenseId));
    console.log(`✅ Manual link complete: deleted receipt ${receiptExpenseId}, merged into bank ${bankExpenseId}`);

    // 7. Return the merged expense
    return (await expensesApi.get(bankExpenseId))!;
  },

  /**
   * Upload single receipt and process with backend AI
   */
  upload: async (file: File): Promise<Expense> => {
    return expensesApi.uploadMultiple([file]);
  },

  /**
   * Upload receipt and process with backend AI (legacy)
   */
  uploadLegacy: async (file: File): Promise<Expense> => {
    console.log("📤 Starting upload for file:", file.name);

    // 1. Upload image to Firebase Storage
    let imageUrl: string;
    try {
      imageUrl = await storageApi.uploadReceipt(file);
      console.log("✅ Image uploaded to Firebase:", imageUrl);
    } catch (storageError: any) {
      console.error("❌ Firebase Storage error:", storageError);
      throw new Error(`Firebase Storage hatası: ${storageError.message}`);
    }

    // 2. Create initial expense record in Firestore
    let expenseId: string;
    try {
      expenseId = await expensesApi.create({
        receipt_image_url: imageUrl,
        processing_status: "processing",
        is_verified: false,
        original_currency: "CAD",
        exchange_rate: 1.0,
        tax_amount: 0,
        gst_amount: 0,
        hst_amount: 0,
        pst_amount: 0,
        category: "uncategorized",
        jurisdiction: "unknown",
        payment_source: "unknown",
      });
      console.log("✅ Expense created in Firestore:", expenseId);
    } catch (firestoreError: any) {
      console.error("❌ Firestore error:", firestoreError);
      throw new Error(`Firestore hatası: ${firestoreError.message}`);
    }

    try {
      // 3. Send to backend for OCR + Gemini processing
      console.log("🤖 Sending to backend for processing...");
      // Use centralized API URL from runtime-config
      const { API_URL } = await import("./runtime-config");
      const result = await fetchJsonWithRetry<any>(
        `${API_URL}/api/process-receipt/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expense_id: expenseId,
            image_url: imageUrl,
          }),
        }
      );
      console.log("✅ Backend processing complete:", result);

      // 4. Update expense with parsed data (store date as ISO string to avoid timezone issues)
      await expensesApi.update(expenseId, {
        vendor_name: result.vendor_name,
        transaction_date: result.transaction_date || null, // Keep as YYYY-MM-DD string
        category: result.category || "uncategorized",
        jurisdiction: result.jurisdiction || "unknown",
        original_amount: result.total_amount,
        original_currency: result.currency || "CAD",
        tax_amount: result.tax_amount || 0,
        gst_amount: result.gst_amount || 0,
        hst_amount: result.hst_amount || 0,
        pst_amount: result.pst_amount || 0,
        gst_itc_estimated: false,
        exchange_rate: result.exchange_rate || 1.0,
        cad_amount: result.cad_amount || result.total_amount,
        card_last_4: result.card_last_4,
        raw_ocr_text: result.raw_text,
        processing_status: "completed",
      });

      // Return updated expense
      return (await expensesApi.get(expenseId))!;

    } catch (error: any) {
      console.error("❌ Processing error:", error);
      // Update with error
      await expensesApi.update(expenseId, {
        processing_status: "error",
        error_message: error.message,
      });

      throw error;
    }
  },
};

// ============ CARDS ============

export const cardsApi = {
  list: async (): Promise<Card[]> => {
    const q = query(collection(db, CARDS_COLLECTION), orderBy("created_at", "desc"));
    const querySnapshot = await getDocs(q);

    const cards: Card[] = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      cards.push({
        id: docSnap.id,
        ...data,
        created_at: toDate(data.created_at),
      } as Card);
    });

    return cards;
  },

  create: async (data: { last_four: string; card_name: string; is_company_card: boolean; currency?: "CAD" | "USD" }): Promise<string> => {
    const docRef = await addDoc(collection(db, CARDS_COLLECTION), {
      ...data,
      created_at: Timestamp.fromDate(new Date()),
    });
    return docRef.id;
  },

  update: async (id: string, data: Partial<Card>): Promise<void> => {
    const docRef = doc(db, CARDS_COLLECTION, id);
    const { id: _, created_at, ...updateData } = data;
    await updateDoc(docRef, updateData);
  },

  delete: async (id: string): Promise<void> => {
    const docRef = doc(db, CARDS_COLLECTION, id);
    await deleteDoc(docRef);
  },
};

// ============ REVENUE ============

/**
 * Normalize RBC CSV / bank dates to YYYY-MM-DD for Bank of Canada FX lookups.
 * RBC Canada exports use M/D/YYYY (e.g. 1/2/2025 = January 2, 2025).
 * Avoids Date.parse timezone drift vs statement calendar day.
 */
export function bankStatementDateToYMD(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  const todayYmd = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  };
  if (!trimmed) return todayYmd();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const md = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (md) {
    const month = parseInt(md[1], 10);
    const day = parseInt(md[2], 10);
    const year = parseInt(md[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return todayYmd();
}

function ymdAddCalendarDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Bank of Canada USD/CAD — uses calendar YYYY-MM-DD only (no UTC midnight shift).
 */
async function fetchBankOfCanadaUsdcadForYmd(dateStr: string): Promise<number> {
  try {
    console.log(`🏦 Bank of Canada: Fetching exchange rate for ${dateStr}...`);

    const apiUrl = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${dateStr}&end_date=${dateStr}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      console.warn(`🏦 Bank of Canada API error: ${response.status}`);
      throw new Error("Failed to fetch exchange rate");
    }

    const data = await response.json();
    const observations = data.observations;

    if (observations && observations.length > 0) {
      const rate = parseFloat(observations[0].FXUSDCAD.v);
      const rateDate = observations[0].d;
      console.log(`🏦 ✅ Rate found for ${rateDate}: 1 USD = ${rate} CAD`);
      return rate;
    }

    console.log(`🏦 ⚠️ No rate for ${dateStr} (weekend/holiday), searching previous business days...`);

    const endDateStr = dateStr;
    const startDateStr = ymdAddCalendarDays(dateStr, -7);
    const rangeUrl = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${startDateStr}&end_date=${endDateStr}`;
    const rangeResponse = await fetch(rangeUrl);

    if (rangeResponse.ok) {
      const rangeData = await rangeResponse.json();
      if (rangeData.observations && rangeData.observations.length > 0) {
        const lastObs = rangeData.observations[rangeData.observations.length - 1];
        const rate = parseFloat(lastObs.FXUSDCAD.v);
        const rateDate = lastObs.d;
        console.log(`🏦 ✅ Closest business day rate (${rateDate}): 1 USD = ${rate} CAD`);
        return rate;
      }
    }

    console.log(`🏦 ⚠️ No rate in range, fetching most recent available...`);
    const fallbackResponse = await fetch(
      `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1`
    );

    if (fallbackResponse.ok) {
      const fallbackData = await fallbackResponse.json();
      if (fallbackData.observations && fallbackData.observations.length > 0) {
        const rate = parseFloat(fallbackData.observations[0].FXUSDCAD.v);
        const rateDate = fallbackData.observations[0].d;
        console.log(`🏦 ⚠️ Using most recent rate (${rateDate}): 1 USD = ${rate} CAD`);
        return rate;
      }
    }

    console.warn(`🏦 ⚠️ Using fallback rate: 1.40`);
    return 1.4;
  } catch (error) {
    console.error("🏦 ❌ Error fetching exchange rate:", error);
    return 1.4;
  }
}

export const revenueApi = {
  /**
   * Create a new revenue entry
   */
  create: async (revenue: Partial<Revenue>): Promise<string> => {
    await ensureAuth();
    const now = new Date();
    const docRef = await addDoc(collection(db, REVENUE_COLLECTION), {
      ...revenue,
      created_at: Timestamp.fromDate(now),
      updated_at: Timestamp.fromDate(now),
    });
    return docRef.id;
  },

  /**
   * Get revenue entry by ID
   */
  get: async (id: string): Promise<Revenue | null> => {
    await ensureAuth();
    const docRef = doc(db, REVENUE_COLLECTION, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      date: data.date ? toDate(data.date) : new Date(),
      created_at: toDate(data.created_at),
      updated_at: toDate(data.updated_at),
    } as Revenue;
  },

  /**
   * List all revenue entries
   */
  list: async (params?: { per_page?: number }): Promise<{ revenues: Revenue[]; total: number }> => {
    await ensureAuth();
    const q = query(
      collection(db, REVENUE_COLLECTION),
      orderBy("date", "desc"),
      limit(params?.per_page || 100)
    );

    const querySnapshot = await getDocs(q);
    const revenues: Revenue[] = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      revenues.push({
        id: docSnap.id,
        ...data,
        date: data.date ? toDate(data.date) : new Date(),
        created_at: toDate(data.created_at),
        updated_at: toDate(data.updated_at),
      } as Revenue);
    });

    return { revenues, total: revenues.length };
  },

  /**
   * Update revenue entry
   */
  update: async (id: string, data: Partial<Revenue>): Promise<void> => {
    await ensureAuth();
    const docRef = doc(db, REVENUE_COLLECTION, id);
    await updateDoc(docRef, {
      ...data,
      updated_at: Timestamp.fromDate(new Date()),
    });
  },

  /**
   * Delete revenue entry
   */
  delete: async (id: string): Promise<void> => {
    // First get the revenue to delete the image
    const revenue = await revenueApi.get(id);
    if (revenue?.image_url) {
      try {
        const imageRef = ref(storage, revenue.image_url);
        await deleteObject(imageRef);
      } catch (e) {
        console.error("Error deleting revenue image:", e);
      }
    }

    const docRef = doc(db, REVENUE_COLLECTION, id);
    await deleteDoc(docRef);
  },

  /**
   * Upload Rate Confirmation document
   */
  uploadDocument: async (file: File): Promise<string> => {
    await ensureAuth();
    const timestamp = Date.now();
    const fileName = `revenue_docs/${timestamp}_${file.name}`;
    const storageRef = ref(storage, fileName);

    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    return downloadURL;
  },

  /**
   * Process Rate Confirmation with OCR + AI parsing
   * Sends to backend for processing and returns parsed data
   */
  processRateConfirmation: async (imageUrl: string): Promise<{
    broker_name: string | null;
    load_id: string | null;
    date: string | null;
    amount_original: number | null;
    currency: "USD" | "CAD";
    raw_text: string | null;
    confidence: number;
  }> => {
    // Import centralized API URL configuration
    const { API_URL } = await import("./runtime-config");
    const url = `${API_URL}/api/process-rate-confirmation/`;

    console.log("🌐 Calling backend API:", url);
    console.log("🌐 Request payload:", { image_url: imageUrl });

    try {
      const data = await fetchJsonWithRetry<{
        broker_name: string | null;
        load_id: string | null;
        date: string | null;
        amount_original: number | null;
        currency: "USD" | "CAD";
        raw_text: string | null;
        confidence: number;
      }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      console.log("🌐 Response data:", data);
      return data;
    } catch (error: any) {
      console.error("🌐 Fetch error:", error);
      if (error.message.includes("Failed to fetch")) {
        throw new Error("Backend server is not running. Please start the backend on port 8000.");
      }
      throw error;
    }
  },

  /**
   * Get summary of all revenue (for dashboard)
   */
  getSummary: async (): Promise<{
    total_usd: number;
    total_cad: number;
    total_original_usd: number;
    total_original_cad: number;
    count: number;
    verified_count: number;
  }> => {
    const { revenues } = await revenueApi.list({ per_page: 1000 });

    const verifiedRevenues = revenues.filter(r => r.status === "verified");

    // Calculate totals with multi-currency support
    let totalOriginalUsd = 0;
    let totalOriginalCad = 0;

    verifiedRevenues.forEach(r => {
      if (r.currency === "USD") {
        totalOriginalUsd += r.amount_original || r.amount_usd || 0;
      } else {
        totalOriginalCad += r.amount_original || 0;
      }
    });

    return {
      // Legacy field for backward compatibility
      total_usd: totalOriginalUsd,
      // All revenues converted to CAD
      total_cad: verifiedRevenues.reduce((sum, r) => sum + (r.amount_cad || 0), 0),
      // Original amounts by currency
      total_original_usd: totalOriginalUsd,
      total_original_cad: totalOriginalCad,
      count: revenues.length,
      verified_count: verifiedRevenues.length,
    };
  },

  /**
   * Fetch Bank of Canada USD/CAD for a JavaScript Date using **local** calendar day
   * (avoids mixing UTC midnight from ISO strings with the wrong BoC date).
   */
  fetchExchangeRate: async (date: Date): Promise<number> => {
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return fetchBankOfCanadaUsdcadForYmd(ymd);
  },

  /**
   * Same as fetchExchangeRate but for raw bank/PDF dates (RBC M/D/YYYY, ISO, etc.).
   * Use this for CSV import rows so the BoC query matches the statement date.
   */
  fetchExchangeRateForBankDate: async (raw: string | null | undefined): Promise<number> => {
    return fetchBankOfCanadaUsdcadForYmd(bankStatementDateToYMD(raw));
  },
};

// ============ DUPLICATE PREVENTION ============

/**
 * Generate a simple hash string from text content.
 * Uses a fast non-crypto hash (djb2) for fingerprinting.
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a fingerprint for a bank transaction.
 * Combines date + description + amount for uniqueness.
 */
function bankTransactionFingerprint(tx: {
  transaction_date: string;
  description1: string;
  description2: string;
  amount_cad: number | null;
  amount_usd: number | null;
}): string {
  const parts = [
    tx.transaction_date || "",
    (tx.description1 || "").trim().toLowerCase(),
    (tx.description2 || "").trim().toLowerCase(),
    (tx.amount_cad ?? tx.amount_usd ?? 0).toFixed(2),
  ];
  return `bank_${hashString(parts.join("|"))}`;
}

/**
 * Generate a fingerprint for a factoring entry.
 * Combines date + description + amount + reference for uniqueness.
 */
function factoringEntryFingerprint(entry: {
  date: string | null;
  description: string;
  amount: number;
  reference: string | null;
  type: string;
}): string {
  const parts = [
    entry.date || "",
    (entry.description || "").trim().toLowerCase(),
    entry.amount.toFixed(2),
    (entry.reference || "").trim(),
    entry.type || "",
  ];
  return `factoring_${hashString(parts.join("|"))}`;
}

export const duplicateCheckApi = {
  /**
   * Check if a file has already been imported by its content hash.
   * Returns true if duplicate.
   */
  checkFileHash: async (fileContent: string, type: "bank_csv" | "factoring_pdf"): Promise<{
    isDuplicate: boolean;
    importedAt?: Date;
    importId?: string;
  }> => {
    await ensureAuth();
    const fileHash = `${type}_file_${hashString(fileContent)}`;
    const docRef = doc(db, IMPORT_HASHES_COLLECTION, fileHash);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        isDuplicate: true,
        importedAt: toDate(data.imported_at),
        importId: docSnap.id,
      };
    }
    return { isDuplicate: false };
  },

  /**
   * Register a file as imported.
   */
  registerFileImport: async (
    fileContent: string,
    type: "bank_csv" | "factoring_pdf",
    metadata: { filename: string; records_count: number }
  ): Promise<string> => {
    await ensureAuth();
    const fileHash = `${type}_file_${hashString(fileContent)}`;
    await setDoc(doc(db, IMPORT_HASHES_COLLECTION, fileHash), {
      type,
      filename: metadata.filename,
      records_count: metadata.records_count,
      imported_at: Timestamp.fromDate(new Date()),
    });
    return fileHash;
  },

  /**
   * Check which transaction fingerprints already exist.
   * Returns a Set of fingerprints that are already imported.
   */
  checkTransactionFingerprints: async (fingerprints: string[]): Promise<Set<string>> => {
    await ensureAuth();
    const existing = new Set<string>();

    // Batch check - read each fingerprint doc
    // Firestore doesn't support IN query on doc IDs efficiently for > 30,
    // so we check in batches of 30
    const batchSize = 30;
    for (let i = 0; i < fingerprints.length; i += batchSize) {
      const batch = fingerprints.slice(i, i + batchSize);
      const promises = batch.map(async (fp) => {
        const docRef = doc(db, IMPORT_HASHES_COLLECTION, fp);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          existing.add(fp);
        }
      });
      await Promise.all(promises);
    }

    return existing;
  },

  /**
   * Register a single transaction fingerprint as imported.
   */
  registerTransactionFingerprint: async (fingerprint: string, type: string): Promise<void> => {
    await setDoc(doc(db, IMPORT_HASHES_COLLECTION, fingerprint), {
      type,
      imported_at: Timestamp.fromDate(new Date()),
    });
  },

  /**
   * Register multiple transaction fingerprints in batch.
   */
  registerTransactionFingerprints: async (fingerprints: string[], type: string): Promise<void> => {
    await ensureAuth();
    const now = Timestamp.fromDate(new Date());
    const promises = fingerprints.map((fp) =>
      setDoc(doc(db, IMPORT_HASHES_COLLECTION, fp), {
        type,
        imported_at: now,
      })
    );
    await Promise.all(promises);
  },
};

// ============ BANK IMPORT ============

export interface BankTransaction {
  index: number;
  transaction_date: string;
  description1: string;
  description2: string;
  amount_cad: number | null;
  amount_usd: number | null;
  type: "expense" | "income" | "transfer" | "owner_draw" | "tax_refund";
  category: string;
  payment_source: string;
  vendor_name: string;
  notes: string;
  confidence: number;
  is_asset_candidate?: boolean;
  // UI state
  selected?: boolean;
}

export interface BankImportSummary {
  total_transactions: number;
  total_income: number;
  total_expenses: number;
  total_transfers: number;
  expense_count: number;
  income_count: number;
  transfer_count: number;
  account_currency?: string; // "CAD", "USD", or "MIXED"
}

export const bankImportApi = {
  /**
   * Parse bank CSV and categorize transactions using AI
   */
  parseCSV: async (csvContent: string): Promise<{
    transactions: BankTransaction[];
    summary: BankImportSummary;
  }> => {
    const { API_URL } = await import("./runtime-config");
    return fetchJsonWithRetry<{
      transactions: BankTransaction[];
      summary: BankImportSummary;
    }>(`${API_URL}/api/bank-import/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_content: csvContent }),
    });
  },

  /**
   * Clean up misclassified bank import data in Firestore.
   * Removes:
   *   - Expenses that are actually transfers (Funds transfer, PAYMENT - THANK YOU)
   *   - Expenses that are actually owner draws (Cash withdrawal)
   *   - Revenue entries that are actually transfers (PAYMENT - THANK YOU, Funds transfer)
   *   - Revenue from owner (e-Transfer from Yeliz/Ozan Bektas)
   * Also removes corresponding fingerprints from import_hashes.
   */
  cleanupMisclassifiedData: async (): Promise<{
    expenses_deleted: number;
    revenues_deleted: number;
    fingerprints_cleared: number;
    total_amount_removed: number;
  }> => {
    await ensureAuth();
    let expenses_deleted = 0;
    let revenues_deleted = 0;
    let fingerprints_cleared = 0;
    let total_amount_removed = 0;

    // Patterns that should NEVER be an expense
    const expenseDeletePatterns = [
      "funds transfer",
      "payment - thank you",
      "paiement - merci",
      "cash withdrawal",
      "atm withdrawal",
      "online banking transfer",
    ];

    // Patterns that should NEVER be revenue
    const revenueDeletePatterns = [
      "payment - thank you",
      "paiement - merci",
      "funds transfer",
      "online banking transfer",
      "credit memo",
      // Tax refunds from CRA are NOT business revenue
      "gst",
      "hst",
      "receiver general",
      "rec gen",
      "canada revenue",
      "cra",
      "fed govt",
    ];

    // Owner names - e-Transfers from these are NOT business revenue
    const ownerNames = ["yeliz bektas", "ozan bektas"];

    // 1. Clean up expenses
    const expQ = query(
      collection(db, EXPENSES_COLLECTION),
      where("entry_type", "==", "bank_import")
    );
    const expSnap = await getDocs(expQ);

    const expToDelete: { ref: any; fp: string | null; amount: number }[] = [];
    expSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const notes = (data.notes || "").toLowerCase();
      const vendor = (data.vendor_name || "").toLowerCase();

      const shouldDelete = expenseDeletePatterns.some(
        (pattern) => notes.includes(pattern) || vendor.includes(pattern)
      );

      if (shouldDelete) {
        expToDelete.push({
          ref: docSnap.ref,
          fp: data.import_fingerprint || null,
          amount: data.cad_amount || 0,
        });
      }
    });

    // 2. Clean up revenues
    let revToDelete: { ref: any; fp: string | null; amount: number }[] = [];
    try {
      const revQ = query(
        collection(db, REVENUE_COLLECTION),
        where("notes", ">=", "[Bank Import]"),
        where("notes", "<=", "[Bank Import]\uf8ff")
      );
      const revSnap = await getDocs(revQ);

      revSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const notes = (data.notes || "").toLowerCase();
        const broker = (data.broker_name || "").toLowerCase();

        const isTransferPattern = revenueDeletePatterns.some(
          (pattern) => notes.includes(pattern) || broker.includes(pattern)
        );
        const isOwnerTransfer = ownerNames.some(
          (name) => notes.includes(name) || broker.includes(name)
        );

        if (isTransferPattern || isOwnerTransfer) {
          revToDelete.push({
            ref: docSnap.ref,
            fp: data.import_fingerprint || null,
            amount: data.amount_cad || 0,
          });
        }
      });
    } catch {
      // Revenue query might fail if no index exists
      console.warn("Could not query revenues for cleanup");
    }

    // 3. Delete everything
    for (const item of expToDelete) {
      await deleteDoc(item.ref);
      total_amount_removed += item.amount;
      expenses_deleted++;
      if (item.fp) {
        try {
          await deleteDoc(doc(db, IMPORT_HASHES_COLLECTION, item.fp));
          fingerprints_cleared++;
        } catch { /* ignore */ }
      }
    }

    for (const item of revToDelete) {
      await deleteDoc(item.ref);
      total_amount_removed += item.amount;
      revenues_deleted++;
      if (item.fp) {
        try {
          await deleteDoc(doc(db, IMPORT_HASHES_COLLECTION, item.fp));
          fingerprints_cleared++;
        } catch { /* ignore */ }
      }
    }

    return { expenses_deleted, revenues_deleted, fingerprints_cleared, total_amount_removed };
  },

  /**
   * Preview bulk delete: count records that would be deleted for a given date range.
   */
  bulkDeletePreview: async (startDate: Date, endDate: Date): Promise<{
    expenses_count: number;
    expenses_total: number;
    revenues_count: number;
    revenues_total: number;
    fingerprints_count: number;
  }> => {
    await ensureAuth();
    let expenses_count = 0;
    let expenses_total = 0;
    let revenues_count = 0;
    let revenues_total = 0;
    let fingerprints_count = 0;

    // Count expenses in date range
    const expSnap = await getDocs(collection(db, EXPENSES_COLLECTION));
    expSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const txDate = data.transaction_date
        ? (typeof data.transaction_date === "string"
          ? new Date(data.transaction_date)
          : data.transaction_date.toDate?.() || new Date(data.transaction_date))
        : null;
      if (txDate && txDate >= startDate && txDate <= endDate) {
        expenses_count++;
        expenses_total += data.cad_amount || 0;
      }
    });

    // Count revenues in date range
    const revSnap = await getDocs(collection(db, REVENUE_COLLECTION));
    revSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const txDate = data.date
        ? (typeof data.date === "string"
          ? new Date(data.date)
          : data.date.toDate?.() || new Date(data.date))
        : null;
      if (txDate && txDate >= startDate && txDate <= endDate) {
        revenues_count++;
        revenues_total += data.amount_cad || 0;
      }
    });

    // Count fingerprints (all of them for now since they don't have dates)
    fingerprints_count = expenses_count + revenues_count;

    return { expenses_count, expenses_total, revenues_count, revenues_total, fingerprints_count };
  },

  /**
   * Bulk delete all data (expenses, revenues, fingerprints) within a date range.
   * If deleteAll=true, deletes ALL data regardless of date.
   */
  bulkDelete: async (startDate: Date, endDate: Date, deleteAll = false): Promise<{
    expenses_deleted: number;
    revenues_deleted: number;
    fingerprints_deleted: number;
    total_expenses_amount: number;
    total_revenues_amount: number;
  }> => {
    await ensureAuth();
    let expenses_deleted = 0;
    let revenues_deleted = 0;
    let fingerprints_deleted = 0;
    let total_expenses_amount = 0;
    let total_revenues_amount = 0;

    const fingerprintsToDelete: string[] = [];

    // Delete expenses
    const expSnap = await getDocs(collection(db, EXPENSES_COLLECTION));
    for (const docSnap of expSnap.docs) {
      const data = docSnap.data();
      let shouldDelete = deleteAll;

      if (!deleteAll) {
        const txDate = data.transaction_date
          ? (typeof data.transaction_date === "string"
            ? new Date(data.transaction_date)
            : data.transaction_date.toDate?.() || new Date(data.transaction_date))
          : null;
        shouldDelete = txDate !== null && txDate >= startDate && txDate <= endDate;
      }

      if (shouldDelete) {
        if (data.import_fingerprint) {
          fingerprintsToDelete.push(data.import_fingerprint);
        }
        await deleteDoc(docSnap.ref);
        expenses_deleted++;
        total_expenses_amount += data.cad_amount || 0;
      }
    }

    // Delete revenues
    const revSnap = await getDocs(collection(db, REVENUE_COLLECTION));
    for (const docSnap of revSnap.docs) {
      const data = docSnap.data();
      let shouldDelete = deleteAll;

      if (!deleteAll) {
        const txDate = data.date
          ? (typeof data.date === "string"
            ? new Date(data.date)
            : data.date.toDate?.() || new Date(data.date))
          : null;
        shouldDelete = txDate !== null && txDate >= startDate && txDate <= endDate;
      }

      if (shouldDelete) {
        if (data.import_fingerprint) {
          fingerprintsToDelete.push(data.import_fingerprint);
        }
        await deleteDoc(docSnap.ref);
        revenues_deleted++;
        total_revenues_amount += data.amount_cad || 0;
      }
    }

    // Delete fingerprints
    if (deleteAll) {
      // Delete ALL fingerprints
      const fpSnap = await getDocs(collection(db, IMPORT_HASHES_COLLECTION));
      for (const docSnap of fpSnap.docs) {
        await deleteDoc(docSnap.ref);
        fingerprints_deleted++;
      }
    } else {
      // Delete only fingerprints for deleted records
      for (const fp of fingerprintsToDelete) {
        try {
          await deleteDoc(doc(db, IMPORT_HASHES_COLLECTION, fp));
          fingerprints_deleted++;
        } catch { /* ignore */ }
      }
    }

    return {
      expenses_deleted,
      revenues_deleted,
      fingerprints_deleted,
      total_expenses_amount: Math.round(total_expenses_amount * 100) / 100,
      total_revenues_amount: Math.round(total_revenues_amount * 100) / 100,
    };
  },

  /**
   * Match bank transactions against existing manually-entered expenses.
   * Uses amount + date proximity + vendor name similarity to find matches.
   * Returns a map of transaction index → matched expense doc ID.
   */
  matchTransactionsToExistingExpenses: async (
    transactions: BankTransaction[]
  ): Promise<Map<number, { expenseId: string; expenseData: any; matchScore: number; matchReason: string }>> => {
    await ensureAuth();
    const matches = new Map<number, { expenseId: string; expenseData: any; matchScore: number; matchReason: string }>();

    // Load all manually-entered expenses (NOT from bank_import)
    // These are the ones created via receipt upload or manual entry
    const allExpSnap = await getDocs(collection(db, EXPENSES_COLLECTION));
    const manualExpenses: { id: string; data: any }[] = [];

    allExpSnap.forEach((docSnap) => {
      const data = docSnap.data();
      // Only consider non-bank-import entries that haven't been linked yet
      if (data.entry_type !== "bank_import" && !data.bank_linked) {
        manualExpenses.push({ id: docSnap.id, data });
      }
    });

    if (manualExpenses.length === 0) return matches;

    // Track which expenses have been matched to prevent double-matching
    const matchedExpenseIds = new Set<string>();

    for (const tx of transactions) {
      if (tx.type !== "expense") continue;

      const txAmount = Math.abs(tx.amount_cad || tx.amount_usd || 0);
      if (txAmount === 0) continue;

      const txDate = tx.transaction_date ? new Date(tx.transaction_date) : null;
      if (!txDate) continue;

      const txVendor = (tx.vendor_name || tx.description1 || "").toLowerCase();

      let bestMatch: { expenseId: string; expenseData: any; score: number; reason: string } | null = null;

      for (const exp of manualExpenses) {
        if (matchedExpenseIds.has(exp.id)) continue;

        const expData = exp.data;
        const expAmount = expData.cad_amount || expData.original_amount || 0;
        const expDate = expData.transaction_date
          ? (typeof expData.transaction_date === "string"
            ? new Date(expData.transaction_date)
            : expData.transaction_date.toDate?.() || new Date(expData.transaction_date))
          : null;
        const expVendor = (expData.vendor_name || "").toLowerCase();

        // === SCORING ===
        let score = 0;
        const reasons: string[] = [];

        // 1. Amount match (most important)
        const amountDiff = Math.abs(txAmount - expAmount);
        const amountPercent = txAmount > 0 ? (amountDiff / txAmount) * 100 : 100;

        if (amountDiff < 0.02) {
          score += 50; // Exact match
          reasons.push("exact amount");
        } else if (amountDiff < 1.0) {
          score += 40; // Within $1 (rounding differences)
          reasons.push(`amount ±${amountDiff.toFixed(2)} CAD`);
        } else if (amountPercent < 2) {
          score += 25; // Within 2% (tax/tip differences)
          reasons.push(`amount ~${amountPercent.toFixed(1)}% diff`);
        } else {
          continue; // Amount too different, skip
        }

        // 2. Date match
        if (expDate && txDate) {
          const daysDiff = Math.abs(
            (txDate.getTime() - expDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysDiff < 1) {
            score += 30; // Same day
            reasons.push("same day");
          } else if (daysDiff <= 3) {
            score += 20; // Within 3 days (posting lag)
            reasons.push(`${Math.round(daysDiff)}d apart`);
          } else if (daysDiff <= 7) {
            score += 10; // Within a week
            reasons.push(`${Math.round(daysDiff)}d apart`);
          } else {
            continue; // Date too far apart, skip
          }
        }

        // 3. Vendor name match
        if (txVendor && expVendor) {
          const vendorWords = txVendor.split(/[\s,.\-\/]+/).filter((w: string) => w.length > 2);
          const expWords = expVendor.split(/[\s,.\-\/]+/).filter((w: string) => w.length > 2);
          const commonWords = vendorWords.filter((w: string) =>
            expWords.some((ew: string) => ew.includes(w) || w.includes(ew))
          );

          if (txVendor === expVendor) {
            score += 20;
            reasons.push("exact vendor");
          } else if (commonWords.length > 0) {
            score += 10;
            reasons.push("vendor partial match");
          }
        }

        // Keep best match above threshold
        if (score >= 60 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = {
            expenseId: exp.id,
            expenseData: expData,
            score,
            reason: reasons.join(", "),
          };
        }
      }

      if (bestMatch) {
        matches.set(tx.index, {
          expenseId: bestMatch.expenseId,
          expenseData: bestMatch.expenseData,
          matchScore: bestMatch.score,
          matchReason: bestMatch.reason,
        });
        matchedExpenseIds.add(bestMatch.expenseId);
      }
    }

    return matches;
  },

  /**
   * Import selected bank transactions as expenses/revenue into Firestore.
   * Includes smart duplicate prevention:
   *   - If a fingerprint exists AND the existing record has valid data → skip (true duplicate)
   *   - If a fingerprint exists BUT the existing record has bad data (cad_amount<0.01) → replace it
   *   - If a fingerprint exists BUT no matching record found (stale) → clear fingerprint, re-import
   *   - If forceReimport=true → delete all existing matching records and re-import everything
   *   - NEW: Matches bank transactions to existing manual/OCR expenses and links them instead of creating duplicates
   */
  importTransactions: async (
    transactions: BankTransaction[],
    forceReimport = false,
    matchedExpenses?: Map<number, { expenseId: string; expenseData: any; matchScore: number; matchReason: string }>
  ): Promise<{
    expenses_created: number;
    revenues_created: number;
    skipped: number;
    duplicates_skipped: number;
    replaced: number;
    linked: number;
  }> => {
    await ensureAuth();
    const now = new Date();
    let expenses_created = 0;
    let revenues_created = 0;
    let skipped = 0;
    let duplicates_skipped = 0;
    let replaced = 0;
    let linked = 0;

    // Generate fingerprints for all transactions
    const fingerprints = transactions.map((tx) => bankTransactionFingerprint(tx));

    // Check which ones already exist
    const existingFingerprints = await duplicateCheckApi.checkTransactionFingerprints(fingerprints);

    // Handle existing fingerprints: smart detection or force re-import
    if (existingFingerprints.size > 0) {
      // Query all bank_import expenses and revenues to cross-reference
      const expQ = query(
        collection(db, EXPENSES_COLLECTION),
        where("entry_type", "==", "bank_import")
      );
      const expSnap = await getDocs(expQ);

      let revSnap: any = null;
      try {
        const revQ = query(
          collection(db, REVENUE_COLLECTION),
          where("notes", ">=", "[Bank Import]"),
          where("notes", "<=", "[Bank Import]\uf8ff")
        );
        revSnap = await getDocs(revQ);
      } catch {
        // If revenue query fails (e.g., no index), skip
      }

      // Build a map of fingerprint → { docRef, isBad }
      const recordMap = new Map<string, { ref: any; isBad: boolean }[]>();

      expSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const docFp = data.import_fingerprint;
        if (docFp && existingFingerprints.has(docFp)) {
          const cadAmount = data.cad_amount ?? 0;
          // A record is "bad" if cad_amount is effectively 0
          const isBad = typeof cadAmount === "number" && cadAmount < 0.01;
          if (!recordMap.has(docFp)) recordMap.set(docFp, []);
          recordMap.get(docFp)!.push({ ref: docSnap.ref, isBad });
        }
      });

      if (revSnap) {
        revSnap.forEach((docSnap: any) => {
          const data = docSnap.data();
          const docFp = data.import_fingerprint;
          if (docFp && existingFingerprints.has(docFp)) {
            const cadAmount = data.amount_cad ?? 0;
            const isBad = typeof cadAmount === "number" && cadAmount < 0.01;
            if (!recordMap.has(docFp)) recordMap.set(docFp, []);
            recordMap.get(docFp)!.push({ ref: docSnap.ref, isBad });
          }
        });
      }

      // Determine which fingerprints to clear
      const fingerprintsToRemove: string[] = [];
      const docsToDelete: any[] = [];

      existingFingerprints.forEach((fp) => {
        const records = recordMap.get(fp);

        if (forceReimport) {
          // Force mode: delete ALL existing records for this fingerprint
          fingerprintsToRemove.push(fp);
          if (records) {
            records.forEach((r) => docsToDelete.push(r.ref));
          }
        } else if (!records || records.length === 0) {
          // Stale fingerprint: no matching record in DB, clear it
          fingerprintsToRemove.push(fp);
        } else {
          // Check if all records for this fingerprint are bad
          const allBad = records.every((r) => r.isBad);
          if (allBad) {
            fingerprintsToRemove.push(fp);
            records.forEach((r) => docsToDelete.push(r.ref));
          }
        }
      });

      // Delete bad/old records
      if (docsToDelete.length > 0) {
        console.log(`🔄 Deleting ${docsToDelete.length} old/bad records for re-import...`);
        for (const docRef of docsToDelete) {
          await deleteDoc(docRef);
        }
      }

      // Delete stale/bad fingerprints from import_hashes
      if (fingerprintsToRemove.length > 0) {
        console.log(`🔄 Clearing ${fingerprintsToRemove.length} fingerprints for re-import...`);
        for (const fp of fingerprintsToRemove) {
          const fpDocRef = doc(db, IMPORT_HASHES_COLLECTION, fp);
          await deleteDoc(fpDocRef);
          existingFingerprints.delete(fp);
        }
        replaced = docsToDelete.length;
      }
    }

    const newFingerprints: string[] = [];

    /** One BoC call per statement calendar day (many rows share the same date). */
    const usdRateByStatementYmd = new Map<string, number>();
    const getUsdRateForBankRow = async (transactionDateRaw: string) => {
      const ymd = bankStatementDateToYMD(transactionDateRaw);
      const cached = usdRateByStatementYmd.get(ymd);
      if (cached !== undefined) return cached;
      const rate = await revenueApi.fetchExchangeRateForBankDate(transactionDateRaw);
      usdRateByStatementYmd.set(ymd, rate);
      return rate;
    };

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      const fp = fingerprints[i];

      // Skip true duplicates (fingerprint exists AND record has valid data)
      if (existingFingerprints.has(fp)) {
        duplicates_skipped++;
        continue;
      }

      try {
        if (tx.type === "expense") {
          // Check if this transaction matches an existing manually-entered expense
          const match = matchedExpenses?.get(tx.index);

          if (match) {
            // LINK to existing expense instead of creating new one
            const expDocRef = doc(db, EXPENSES_COLLECTION, match.expenseId);
            await updateDoc(expDocRef, {
              bank_linked: true,
              bank_import_date: Timestamp.fromDate(now),
              bank_description: `${tx.description1} - ${tx.description2}`.trim(),
              bank_statement_date: tx.transaction_date,
              bank_match_score: match.matchScore,
              bank_match_reason: match.matchReason,
              import_fingerprint: fp,
              updated_at: Timestamp.fromDate(now),
            });
            linked++;
            newFingerprints.push(fp);
          } else {
            // No match - create new expense as before
            const cadVal = tx.amount_cad;
            const usdVal = tx.amount_usd;
            const isUsd =
              usdVal != null &&
              usdVal !== 0 &&
              (cadVal == null || cadVal === 0);
            const originalAmount = Math.abs(isUsd ? (usdVal || 0) : (cadVal || 0));
            const currency = isUsd ? "USD" : "CAD";

            let exchangeRate = 1.0;
            let cadAmount = originalAmount;

            if (isUsd) {
              try {
                exchangeRate = await getUsdRateForBankRow(tx.transaction_date || "");
                cadAmount = Math.round(originalAmount * exchangeRate * 100) / 100;
              } catch {
                exchangeRate = 1.40;
                cadAmount = Math.round(originalAmount * exchangeRate * 100) / 100;
              }
            }

            const jurisdiction = isUsd ? "usa" : "canada";
            const itcAuto =
              computeBcItcAutoFieldsFromGross(
                tx.category || "uncategorized",
                cadAmount,
                jurisdiction,
                currency,
              ) || {
                gst_amount: 0,
                hst_amount: 0,
                pst_amount: 0,
                tax_amount: 0,
                gst_itc_estimated: false,
              };
            await addDoc(collection(db, EXPENSES_COLLECTION), {
              vendor_name: tx.vendor_name || tx.description1,
              transaction_date: tx.transaction_date,
              category: tx.category || "uncategorized",
              jurisdiction,
              original_amount: originalAmount,
              original_currency: currency,
              gst_amount: itcAuto.gst_amount,
              hst_amount: 0,
              pst_amount: 0,
              tax_amount: itcAuto.tax_amount,
              exchange_rate: exchangeRate,
              cad_amount: cadAmount,
              card_last_4: null,
              payment_source: tx.payment_source || "bank_checking",
              receipt_image_url: null,
              raw_ocr_text: null,
              is_verified: true,
              processing_status: "completed",
              error_message: null,
              notes: `[Bank Import] ${tx.notes || ""} | ${tx.description1} - ${tx.description2}`.trim(),
              entry_type: "bank_import",
              import_fingerprint: fp,
              gst_itc_estimated: itcAuto.gst_itc_estimated,
              created_at: Timestamp.fromDate(now),
              updated_at: Timestamp.fromDate(now),
            });
            expenses_created++;
          }
          newFingerprints.push(fp);
        } else if (tx.type === "income") {
          const cadVal = tx.amount_cad;
          const usdVal = tx.amount_usd;
          const isUsd =
            usdVal != null &&
            usdVal !== 0 &&
            (cadVal == null || cadVal === 0);
          const originalAmount = Math.abs(isUsd ? (usdVal || 0) : (cadVal || 0));
          const currency = isUsd ? "USD" : "CAD";

          let exchangeRate = 1.0;
          let cadAmount = originalAmount;

          if (isUsd) {
            try {
              exchangeRate = await getUsdRateForBankRow(tx.transaction_date || "");
              cadAmount = Math.round(originalAmount * exchangeRate * 100) / 100;
            } catch {
              exchangeRate = 1.40;
              cadAmount = Math.round(originalAmount * exchangeRate * 100) / 100;
            }
          }

          await addDoc(collection(db, REVENUE_COLLECTION), {
            broker_name: tx.vendor_name || tx.description1,
            load_id: null,
            date: tx.transaction_date,
            amount_original: originalAmount,
            currency: currency,
            exchange_rate: exchangeRate,
            amount_cad: cadAmount,
            image_url: null,
            status: "verified",
            notes: `[Bank Import] ${tx.notes || ""} | ${tx.description1} - ${tx.description2}`.trim(),
            import_fingerprint: fp,
            created_at: Timestamp.fromDate(now),
            updated_at: Timestamp.fromDate(now),
          });
          revenues_created++;
          newFingerprints.push(fp);
        } else {
          // Skip transfers and owner_draw
          skipped++;
        }
      } catch (error) {
        console.error(`Failed to import transaction ${tx.index}:`, error);
        skipped++;
      }
    }

    // Register all new fingerprints
    if (newFingerprints.length > 0) {
      await duplicateCheckApi.registerTransactionFingerprints(newFingerprints, "bank_import");
    }

    return { expenses_created, revenues_created, skipped, duplicates_skipped, replaced, linked };
  },
};

// ============ FACTORING IMPORT ============

export interface FactoringEntry {
  date: string | null;
  type: string;
  description: string;
  amount: number;
  category: string;
  reference: string | null;
  debtor_name: string | null;
  // UI state
  selected?: boolean;
}

export interface FactoringTotals {
  total_fees: number;
  total_purchases: number;
  total_collections: number;
  total_recourse: number;
}

export interface FactoringReportData {
  report_type: string;
  currency: string;
  client_id: string | null;
  date_range: { start?: string; end?: string };
  entries: FactoringEntry[];
  totals: FactoringTotals;
  confidence: number;
}

export const factoringApi = {
  /**
   * Parse a factoring report PDF using Gemini AI
   */
  parsePDF: async (file: File): Promise<FactoringReportData> => {
    // Convert file to base64
    const buffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ""
      )
    );

    const { API_URL } = await import("./runtime-config");
    const idempotencyKey = globalThis.crypto.randomUUID();
    return fetchJsonWithRetry<FactoringReportData>(
      `${API_URL}/api/factoring/parse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          pdf_base64: base64,
          filename: file.name,
        }),
      }
    );
  },

  /**
   * Import selected factoring entries as expenses into Firestore.
   * Includes smart duplicate prevention + force re-import option.
   */
  importEntries: async (
    entries: FactoringEntry[],
    currency: string,
    exchangeRate: number,
    forceReimport = false
  ): Promise<{
    expenses_created: number;
    skipped: number;
    duplicates_skipped: number;
    replaced: number;
  }> => {
    await ensureAuth();
    const now = new Date();
    let expenses_created = 0;
    let skipped = 0;
    let duplicates_skipped = 0;
    let replaced = 0;

    // Generate fingerprints for all entries
    const fingerprints = entries.map((entry) => factoringEntryFingerprint(entry));

    // Check which ones already exist
    const existingFingerprints = await duplicateCheckApi.checkTransactionFingerprints(fingerprints);

    // Handle existing fingerprints: smart detection or force re-import
    if (existingFingerprints.size > 0) {
      const expQ = query(
        collection(db, EXPENSES_COLLECTION),
        where("entry_type", "==", "factoring_import")
      );
      const expSnap = await getDocs(expQ);

      // Build a map of fingerprint → records
      const recordMap = new Map<string, { ref: any; isBad: boolean }[]>();
      expSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const docFp = data.import_fingerprint;
        if (docFp && existingFingerprints.has(docFp)) {
          const cadAmount = data.cad_amount ?? 0;
          const isBad = typeof cadAmount === "number" && cadAmount < 0.01;
          if (!recordMap.has(docFp)) recordMap.set(docFp, []);
          recordMap.get(docFp)!.push({ ref: docSnap.ref, isBad });
        }
      });

      const fingerprintsToRemove: string[] = [];
      const docsToDelete: any[] = [];

      existingFingerprints.forEach((fp) => {
        const records = recordMap.get(fp);

        if (forceReimport) {
          fingerprintsToRemove.push(fp);
          if (records) records.forEach((r) => docsToDelete.push(r.ref));
        } else if (!records || records.length === 0) {
          // Stale fingerprint
          fingerprintsToRemove.push(fp);
        } else {
          const allBad = records.every((r) => r.isBad);
          if (allBad) {
            fingerprintsToRemove.push(fp);
            records.forEach((r) => docsToDelete.push(r.ref));
          }
        }
      });

      if (docsToDelete.length > 0) {
        for (const docRef of docsToDelete) {
          await deleteDoc(docRef);
        }
      }

      if (fingerprintsToRemove.length > 0) {
        for (const fp of fingerprintsToRemove) {
          const fpDocRef = doc(db, IMPORT_HASHES_COLLECTION, fp);
          await deleteDoc(fpDocRef);
          existingFingerprints.delete(fp);
        }
        replaced = docsToDelete.length;
      }
    }

    const newFingerprints: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fp = fingerprints[i];

      // Skip true duplicates (valid existing data)
      if (existingFingerprints.has(fp)) {
        duplicates_skipped++;
        continue;
      }

      try {
        // Only import fee entries as expenses
        if (entry.type === "fee" || entry.category === "factoring_fees") {
          const amount = Math.abs(entry.amount);
          const cadAmount = currency === "CAD" ? amount : amount * exchangeRate;
          const cadRounded = Math.round(cadAmount * 100) / 100;
          const itcFact =
            computeBcItcAutoFieldsFromGross(
              "factoring_fees",
              cadRounded,
              "canada",
              currency,
            ) || {
              gst_amount: 0,
              tax_amount: 0,
              gst_itc_estimated: false,
            };

          await addDoc(collection(db, EXPENSES_COLLECTION), {
            vendor_name: "J D Factors",
            transaction_date: entry.date || null,
            category: "factoring_fees",
            jurisdiction: "canada",
            original_amount: amount,
            original_currency: currency,
            tax_amount: itcFact.tax_amount,
            gst_amount: itcFact.gst_amount,
            hst_amount: 0,
            pst_amount: 0,
            gst_itc_estimated: itcFact.gst_itc_estimated,
            exchange_rate: currency === "CAD" ? 1.0 : exchangeRate,
            cad_amount: cadRounded,
            card_last_4: null,
            payment_source: "bank_checking",
            receipt_image_url: null,
            raw_ocr_text: null,
            is_verified: true,
            processing_status: "completed",
            error_message: null,
            notes: `[Factoring Import] ${entry.description} | Ref: ${entry.reference || "N/A"}`.trim(),
            entry_type: "factoring_import",
            import_fingerprint: fp,
            created_at: Timestamp.fromDate(now),
            updated_at: Timestamp.fromDate(now),
          });
          expenses_created++;
          newFingerprints.push(fp);
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`Failed to import factoring entry:`, error);
        skipped++;
      }
    }

    // Register all new fingerprints
    if (newFingerprints.length > 0) {
      await duplicateCheckApi.registerTransactionFingerprints(newFingerprints, "factoring_import");
    }

    return { expenses_created, skipped, duplicates_skipped, replaced };
  },
};

// ============ EXPORT ============

// CRA Tax Deduction Rates by Category
// These rates determine what percentage of the expense can be deducted from taxable income
// CRA T2125 Deduction Rates by Category
const DEDUCTION_RATES: Record<string, number> = {
  fuel: 1.0,                    // 100% deductible
  maintenance_repairs: 1.0,     // 100% deductible
  insurance: 1.0,               // 100% deductible (truck insurance, cargo, liability)
  licenses_dues: 1.0,           // 100% deductible
  tolls_scales: 1.0,            // 100% deductible
  meals_entertainment: 0.5,     // 50% deductible (CRA standard rule)
  travel_lodging: 1.0,          // 100% deductible
  office_admin: 1.0,            // 100% deductible
  factoring_fees: 1.0,          // 100% deductible (financing cost)
  payroll: 1.0,                 // 100% deductible (wages)
  subcontractor: 1.0,           // 100% deductible
  professional_fees: 1.0,       // 100% deductible
  rent_lease: 1.0,              // 100% deductible
  loan_interest: 1.0,           // 100% deductible (interest only)
  personal: 0.0,                // Not a business deduction
  other_expenses: 1.0,          // 100% deductible
  uncategorized: 0.0,           // 0% - Safety default until categorized
};

const calculateDeductibleAmount = (expense: Expense): number => {
  const cadAmount = expense.cad_amount || 0;
  const category = expense.category || "uncategorized";
  const deductionRate = DEDUCTION_RATES[category] ?? 0.0;
  return cadAmount * deductionRate;
};

// Helper function to format date for export
const formatExportDate = (date: Date | null): string => {
  if (!date) return "";
  return date.toISOString().split("T")[0];
};

// Category display names
const categoryDisplayNames: Record<string, string> = {
  fuel: "Fuel",
  maintenance_repairs: "Maintenance & Repairs",
  insurance: "Insurance",
  licenses_dues: "Licenses & Dues",
  tolls_scales: "Tolls & Scales",
  meals_entertainment: "Meals & Entertainment",
  travel_lodging: "Travel (Lodging)",
  office_admin: "Office & Admin",
  factoring_fees: "Factoring Fees",
  payroll: "Payroll / Wages",
  subcontractor: "Subcontractor",
  professional_fees: "Professional Fees",
  rent_lease: "Rent / Lease",
  loan_interest: "Loan Interest",
  personal: "Personel",
  other_expenses: "Other Expenses",
  uncategorized: "Uncategorized",
};

export const exportApi = {
  /**
   * Generate and download expenses as CSV (client-side)
   */
  downloadCSV: async (params?: {
    start_date?: string;
    end_date?: string;
    verified_only?: boolean;
  }): Promise<Blob> => {
    const allExpenses = await expensesApi.list({ per_page: 1000 });

    // Filter expenses
    let expenses = allExpenses.expenses;
    if (params?.verified_only) {
      expenses = expenses.filter(e => e.is_verified);
    }
    if (params?.start_date) {
      const startDate = new Date(params.start_date);
      expenses = expenses.filter(e => e.transaction_date && new Date(e.transaction_date) >= startDate);
    }
    if (params?.end_date) {
      const endDate = new Date(params.end_date);
      endDate.setHours(23, 59, 59, 999);
      expenses = expenses.filter(e => e.transaction_date && new Date(e.transaction_date) <= endDate);
    }

    const operatingExpenses = expenses.filter((e) => !isExpenseReclassifiedToAsset(e));
    const reclassifiedAssetCount = expenses.length - operatingExpenses.length;
    const plExpenses = operatingExpenses.filter((e) => !isExcludedFromBusinessPl(e));

    // CSV Header (aligns with dashboard net-of-ITC logic)
    const headers = [
      "Date",
      "Vendor",
      "Category",
      "Original Currency",
      "Original Amount",
      "Exchange Rate",
      "CAD Amount",
      "Net Expense (CAD)",
      "Tax Recoverable (ITC)",
      "ITC Source",
      "Payment Source",
      "Due to Shareholder",
      "Jurisdiction",
      "Receipt Link",
      "Notes"
    ];

    // CSV Rows (operating P&L only — excludes Personel and reclassified-to-asset)
    const rows = plExpenses.map(expense => {
      const paymentSource = expense.payment_source === "personal_card" ? "Personal Card" :
        expense.payment_source === "company_card" ? "Company Card" :
          expense.payment_source === "bank_checking" ? "Bank / Checking" :
            expense.payment_source === "e_transfer" ? "e-Transfer" : "Unknown";
      const dueToShareholder = expense.payment_source === "personal_card" ? "Yes" : "No";
      const jurisdiction = expense.jurisdiction === "canada" ? "CANADA" :
        expense.jurisdiction === "usa" ? "USA" : "UNKNOWN";
      const netCad = getNetExpenseCad(expense);
      const itcCad = getEffectiveRecoverableItcCad(expense);
      const itcSource = getItcSourceLabel(expense);

      let notes = expense.notes || "";
      if (expense.category === "meals_entertainment") {
        notes = `50% deductible for CRA. ${notes}`.trim();
      }

      return [
        formatExportDate(expense.transaction_date),
        expense.vendor_name || "",
        categoryDisplayNames[expense.category] || expense.category,
        expense.original_currency,
        expense.original_amount?.toFixed(2) || "",
        expense.exchange_rate !== 1.0 ? expense.exchange_rate.toFixed(4) : "N/A (CAD)",
        expense.cad_amount?.toFixed(2) || "",
        netCad.toFixed(2),
        itcCad.toFixed(2),
        itcSource,
        paymentSource,
        dueToShareholder,
        jurisdiction,
        expense.receipt_image_url || "",
        notes
      ];
    });

    // Build Expenses CSV content
    const expensesCsv = [
      "=== EXPENSES ===",
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ];

    // ===== REVENUES =====
    const allRevenues = await revenueApi.list({ per_page: 1000 });
    let revenues = allRevenues.revenues;

    // Filter verified only if requested
    if (params?.verified_only) {
      revenues = revenues.filter(r => r.status === "verified");
    }

    // Apply date filters to revenues
    if (params?.start_date) {
      const startDate = new Date(params.start_date);
      revenues = revenues.filter(r => r.date && new Date(r.date) >= startDate);
    }
    if (params?.end_date) {
      const endDate = new Date(params.end_date);
      endDate.setHours(23, 59, 59, 999);
      revenues = revenues.filter(r => r.date && new Date(r.date) <= endDate);
    }

    const revenueHeaders = [
      "Date",
      "Broker/Company",
      "Load ID",
      "Original Amount",
      "Currency",
      "Exchange Rate",
      "CAD Amount",
      "Status",
      "Document Link",
      "Notes"
    ];

    const revenueRows = revenues.map(revenue => [
      formatExportDate(revenue.date),
      revenue.broker_name || "",
      revenue.load_id || "",
      revenue.amount_original?.toFixed(2) || "",
      revenue.currency || "CAD",
      revenue.exchange_rate !== 1.0 ? revenue.exchange_rate.toFixed(4) : "N/A (CAD)",
      revenue.amount_cad?.toFixed(2) || "",
      revenue.status === "verified" ? "Verified" : "Pending",
      revenue.image_url || "",
      revenue.notes || ""
    ]);

    const revenuesCsv = [
      "",
      "=== REVENUES ===",
      revenueHeaders.join(","),
      ...revenueRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ];

    // ===== SUMMARY (P&L excludes Personel and reclassified-to-asset) =====
    const pnlExpenses = plExpenses;
    const totalNetExpensesCAD = pnlExpenses.reduce((sum, e) => sum + getNetExpenseCad(e), 0);
    const totalGrossOperatingCAD = pnlExpenses.reduce((sum, e) => sum + (e.cad_amount || 0), 0);
    const totalItcEffective = pnlExpenses.reduce((sum, e) => sum + getEffectiveRecoverableItcCad(e), 0);
    const totalPstRecorded = pnlExpenses.reduce((sum, e) => sum + (e.pst_amount || 0), 0);
    const totalRevenueCAD = revenues.reduce((sum, r) => sum + (r.amount_cad || 0), 0);
    const netProfit = totalRevenueCAD - totalNetExpensesCAD;

    const summaryCsv = [
      "",
      "=== SUMMARY ===",
      `"Gross Revenue (CAD)","${totalRevenueCAD.toFixed(2)}"`,
      `"Total Expenses (CAD) — net of recoverable GST/HST (ITC)","${totalNetExpensesCAD.toFixed(2)}"`,
      `"Gross Operating Expenses (CAD) — before ITC","${totalGrossOperatingCAD.toFixed(2)}"`,
      `"Net Profit (CAD)","${netProfit.toFixed(2)}"`,
      `"",""`,
      `"Total GST+HST Recoverable (ITC) — asset","${totalItcEffective.toFixed(2)}"`,
      `"PST (6-10%) — not recoverable (sunk; included in net expense)","${totalPstRecorded.toFixed(2)}"`,
      `"",""`,
      `"Expense rows in Expenses section (P&L operating only)","${plExpenses.length}"`,
      `"Reclassified to asset (excluded from Expenses section)","${reclassifiedAssetCount}"`,
      `"Verified expense rows in period (before asset exclusion)","${expenses.length}"`,
      `"Revenue Count","${revenues.length}"`
    ];

    // Combine all sections
    const csvContent = [...expensesCsv, ...revenuesCsv, ...summaryCsv].join("\n");

    return new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  },

  /**
   * Generate and download expenses as proper Excel XLSX file
   * Uses SheetJS (xlsx) library for real Excel format
   */
  downloadXLSX: async (params?: {
    start_date?: string;
    end_date?: string;
    verified_only?: boolean;
  }): Promise<Blob> => {
    // Get all expenses
    const allExpenses = await expensesApi.list({ per_page: 1000 });
    let expenses = allExpenses.expenses;

    // Filter verified only if requested
    if (params?.verified_only) {
      expenses = expenses.filter(e => e.is_verified);
    }

    // Apply date filters
    if (params?.start_date) {
      const startDate = new Date(params.start_date);
      expenses = expenses.filter(e =>
        e.transaction_date && new Date(e.transaction_date) >= startDate
      );
    }
    if (params?.end_date) {
      const endDate = new Date(params.end_date);
      endDate.setHours(23, 59, 59, 999);
      expenses = expenses.filter(e =>
        e.transaction_date && new Date(e.transaction_date) <= endDate
      );
    }

    const operatingExpenses = expenses.filter((e) => !isExpenseReclassifiedToAsset(e));
    const reclassifiedAssetCount = expenses.length - operatingExpenses.length;
    const plExpenses = operatingExpenses.filter((e) => !isExcludedFromBusinessPl(e));

    // Prepare data for Excel with separate tax columns + net expense / ITC source (dashboard logic)
    const excelData = plExpenses.map(expense => {
      const category = expense.category || "uncategorized";
      const deductionRate = DEDUCTION_RATES[category] ?? 0.0;
      const deductibleAmount = (expense.cad_amount || 0) * deductionRate;

      // Recorded tax components (receipt / manual line items)
      const gstAmount = expense.gst_amount || 0;
      const hstAmount = expense.hst_amount || 0;
      const pstAmount = expense.pst_amount || 0;

      const effectiveHst = (gstAmount === 0 && hstAmount === 0 && expense.tax_amount)
        ? expense.tax_amount
        : hstAmount;
      const totalTax = gstAmount + effectiveHst + pstAmount;

      const taxRecoverableEffective = getEffectiveRecoverableItcCad(expense);
      const netExpenseCad = getNetExpenseCad(expense);
      const itcSource = getItcSourceLabel(expense);

      const paymentSource = expense.payment_source === "company_card" ? "Company Card"
        : expense.payment_source === "personal_card" ? "Personal Card"
          : expense.payment_source === "bank_checking" ? "Bank / Checking"
            : expense.payment_source === "e_transfer" ? "e-Transfer"
              : "Unknown";
      const dueToShareholder = expense.payment_source === "personal_card"
        ? expense.cad_amount || 0
        : 0;

      const cur = (expense.original_currency || expense.currency || "CAD").toUpperCase();
      const jurisdiction = cur === "USD" || expense.jurisdiction === "usa" ? "USA" : "Canada";

      const notes = deductionRate < 1.0
        ? `${(deductionRate * 100).toFixed(0)}% deductible`
        : "";

      return {
        "Date": formatExportDate(expense.transaction_date),
        "Vendor": expense.vendor_name || "",
        "Category": category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        "Original Amount": expense.original_amount || expense.cad_amount || 0,
        "Currency": expense.currency || expense.original_currency || "CAD",
        "Exchange Rate": expense.exchange_rate !== 1.0 ? expense.exchange_rate?.toFixed(4) : "N/A",
        "CAD Amount": expense.cad_amount || 0,
        "Net Expense (CAD)": netExpenseCad,
        "GST (5%)": gstAmount,
        "HST (13-15%)": effectiveHst,
        "PST (6-10%)": pstAmount,
        "Total Tax": totalTax,
        "Tax Recoverable (ITC)": taxRecoverableEffective,
        "ITC Source": itcSource,
        "Deductible Amount": Math.round(deductibleAmount * 100) / 100,
        "Deduction Rate": `${(deductionRate * 100).toFixed(0)}%`,
        "Card Last 4": expense.card_last_4 || "",
        "Payment Source": paymentSource,
        "Due to Shareholder": dueToShareholder,
        "Jurisdiction": jurisdiction,
        "Receipt URL": expense.receipt_image_url || "",
        "Notes": notes
      };
    });

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // ===== EXPENSES SHEET =====
    const expensesSheet = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, expensesSheet, "Expenses");

    // Set column widths for expenses
    expensesSheet["!cols"] = [
      { wch: 12 },  // Date
      { wch: 25 },  // Vendor
      { wch: 18 },  // Category
      { wch: 12 },  // Original Amount
      { wch: 8 },   // Currency
      { wch: 12 },  // Exchange Rate
      { wch: 12 },  // CAD Amount
      { wch: 14 },  // Net Expense (CAD)
      { wch: 10 },  // GST (5%)
      { wch: 12 },  // HST (13-15%)
      { wch: 10 },  // PST (6-10%)
      { wch: 10 },  // Total Tax
      { wch: 16 },  // Tax Recoverable (ITC)
      { wch: 16 },  // ITC Source
      { wch: 15 },  // Deductible Amount
      { wch: 12 },  // Deduction Rate
      { wch: 10 },  // Card Last 4
      { wch: 14 },  // Payment Source
      { wch: 15 },  // Due to Shareholder
      { wch: 12 },  // Jurisdiction
      { wch: 50 },  // Receipt URL
      { wch: 20 },  // Notes
    ];

    // ===== REVENUES SHEET =====
    const allRevenues = await revenueApi.list({ per_page: 1000 });
    let revenues = allRevenues.revenues;

    // Filter verified only if requested
    if (params?.verified_only) {
      revenues = revenues.filter(r => r.status === "verified");
    }

    // Apply date filters to revenues
    if (params?.start_date) {
      const startDate = new Date(params.start_date);
      revenues = revenues.filter(r =>
        r.date && new Date(r.date) >= startDate
      );
    }
    if (params?.end_date) {
      const endDate = new Date(params.end_date);
      endDate.setHours(23, 59, 59, 999);
      revenues = revenues.filter(r =>
        r.date && new Date(r.date) <= endDate
      );
    }

    // Prepare revenue data for Excel
    const revenueData = revenues.map(revenue => ({
      "Date": formatExportDate(revenue.date),
      "Broker / Company": revenue.broker_name || "",
      "Load ID": revenue.load_id || "",
      "Original Amount": revenue.amount_original || 0,
      "Currency": revenue.currency || "CAD",
      "Exchange Rate": revenue.exchange_rate !== 1.0 ? revenue.exchange_rate?.toFixed(4) : "N/A (CAD)",
      "CAD Amount": revenue.amount_cad || 0,
      "Status": revenue.status === "verified" ? "Verified" : "Pending",
      "Document URL": revenue.image_url || "",
      "Notes": revenue.notes || ""
    }));

    const revenuesSheet = XLSX.utils.json_to_sheet(revenueData);
    XLSX.utils.book_append_sheet(workbook, revenuesSheet, "Revenues");

    // Set column widths for revenues
    revenuesSheet["!cols"] = [
      { wch: 12 },  // Date
      { wch: 25 },  // Broker
      { wch: 15 },  // Load ID
      { wch: 15 },  // Original Amount
      { wch: 8 },   // Currency
      { wch: 12 },  // Exchange Rate
      { wch: 15 },  // CAD Amount
      { wch: 10 },  // Status
      { wch: 50 },  // Document URL
      { wch: 30 },  // Notes
    ];

    // ===== SUMMARY SHEET (P&L excludes Personel and reclassified-to-asset) =====
    const expensesForPnl = plExpenses;
    const totalNetExpensesCAD = expensesForPnl.reduce((sum, e) => sum + getNetExpenseCad(e), 0);
    const totalGrossOperatingCAD = expensesForPnl.reduce((sum, e) => sum + (e.cad_amount || 0), 0);
    const totalItcEffective = expensesForPnl.reduce((sum, e) => sum + getEffectiveRecoverableItcCad(e), 0);
    const totalGSTRecorded = expensesForPnl.reduce((sum, e) => sum + (e.gst_amount || 0), 0);
    const totalHSTRecorded = expensesForPnl.reduce((sum, e) => {
      const hst = e.hst_amount || 0;
      const backwardHst = (e.gst_amount === 0 && hst === 0 && e.tax_amount) ? e.tax_amount : hst;
      return sum + backwardHst;
    }, 0);
    const totalPST = expensesForPnl.reduce((sum, e) => sum + (e.pst_amount || 0), 0);
    const totalDeductible = expensesForPnl.reduce((sum, e) => {
      const cat = e.category || "uncategorized";
      const rate = DEDUCTION_RATES[cat] ?? 0.0;
      return sum + (e.cad_amount || 0) * rate;
    }, 0);
    const totalRevenueCAD = revenues.reduce((sum, r) => sum + (r.amount_cad || 0), 0);
    const netProfit = totalRevenueCAD - totalNetExpensesCAD;

    const summaryData = [
      { "Metric": "Gross Revenue (CAD)", "Value": totalRevenueCAD.toFixed(2) },
      { "Metric": "Total Expenses (CAD) — net of recoverable GST/HST (ITC)", "Value": totalNetExpensesCAD.toFixed(2) },
      { "Metric": "Gross Operating Expenses (CAD) — before ITC", "Value": totalGrossOperatingCAD.toFixed(2) },
      { "Metric": "Net Profit (CAD)", "Value": netProfit.toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "Total GST+HST Recoverable (ITC) — asset", "Value": totalItcEffective.toFixed(2) },
      { "Metric": "PST (6-10%) — not recoverable (sunk; in net expense)", "Value": totalPST.toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "Recorded GST (5%) — line items", "Value": totalGSTRecorded.toFixed(2) },
      { "Metric": "Recorded HST (13-15%) — line items", "Value": totalHSTRecorded.toFixed(2) },
      { "Metric": "Recorded taxes sum (GST+HST+PST)", "Value": (totalGSTRecorded + totalHSTRecorded + totalPST).toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "Tax Deductions (T2125)", "Value": totalDeductible.toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "Expense rows in Expenses sheet (P&L operating only)", "Value": plExpenses.length.toString() },
      { "Metric": "Reclassified to asset (excluded)", "Value": reclassifiedAssetCount.toString() },
      { "Metric": "Verified rows in period (before asset exclusion)", "Value": expenses.length.toString() },
      { "Metric": "Revenue rows", "Value": revenues.length.toString() },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    summarySheet["!cols"] = [
      { wch: 25 },  // Metric
      { wch: 15 },  // Value
    ];

    // Generate binary Excel file
    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array"
    });

    return new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  },

  getSummary: async (params?: { start_date?: string; end_date?: string }): Promise<any> => {
    const allExpenses = await expensesApi.list({ per_page: 1000 });

    // Only count verified expenses for summary (matching backend behavior)
    let filteredExpenses = allExpenses.expenses.filter(e => e.is_verified);
    filteredExpenses = filteredExpenses.filter((e) => !isExpenseReclassifiedToAsset(e));
    filteredExpenses = filteredExpenses.filter((e) => !isExcludedFromBusinessPl(e));

    // Apply date filters if provided
    if (params?.start_date) {
      const startDate = new Date(params.start_date);
      filteredExpenses = filteredExpenses.filter(e =>
        e.transaction_date && new Date(e.transaction_date) >= startDate
      );
    }
    if (params?.end_date) {
      const endDate = new Date(params.end_date);
      endDate.setHours(23, 59, 59, 999); // Include the whole end day
      filteredExpenses = filteredExpenses.filter(e =>
        e.transaction_date && new Date(e.transaction_date) <= endDate
      );
    }

    const expenses = {
      ...allExpenses,
      expenses: filteredExpenses
    };


    const totals = {
      /** Gross CAD (bank / receipt totals) — unchanged for exports that need gross. */
      total_cad: 0,
      /** Operating expenses net of recoverable GST/HST (ITC); PST remains in this total. */
      total_net_expense_cad: 0,
      expense_count: expenses.expenses.length,
      total_tax_recoverable: 0,
      total_gst: 0,   // GST only (5%) - ITC recoverable
      total_hst: 0,   // HST only (13-15%) - ITC recoverable
      total_pst: 0,   // PST only (6-10%) - NOT recoverable
      total_tax: 0,   // Sum of GST + HST + PST
      total_potential_deductions: 0,  // T2125 tax deductions
      meals_50_percent: 0,  // 50% deductible portion of meals
      /** CCA depreciation for a full Jan 1 – Dec 31 calendar year (CRA); 0 for partial-year views */
      cca_deduction_cad: 0,
      /** Net operating expenses + CCA — use for net profit on full-year views */
      total_pnl_expense_cad: 0,
      /** Calendar year when CCA is included, or null */
      cca_fiscal_year: null as number | null,
    };

    const by_category: Record<string, {
      total_cad: number;
      total_net_cad: number;
      /** Sum of effective recoverable ITC (GST+HST) per BC/category rules — matches net vs gross gap. */
      total_itc_cad: number;
      count: number;
      total_deductible: number;
      total_gst: number;
      total_hst: number;
      total_pst: number;
      total_tax: number;
    }> = {};
    const by_payment_source: Record<string, number> = {
      company_expenses: 0,
      due_to_shareholder: 0,
      bank_checking: 0,
      e_transfer: 0,
      unknown: 0,
    };
    // Currency breakdown for expenses (gross in original/converted; net aligns with Total Expenses / exports)
    const by_currency = {
      cad: { original_total: 0, net_total_cad: 0, count: 0 },
      usd: {
        original_total: 0,
        converted_cad: 0,
        net_converted_cad: 0,
        count: 0,
        avg_rate: 0,
      },
    };

    expenses.expenses.forEach((expense) => {
      const cadAmount = expense.cad_amount || 0;
      const netCad = getNetExpenseCad(expense);
      const itcCad = getEffectiveRecoverableItcCad(expense);
      totals.total_cad += cadAmount;
      totals.total_net_expense_cad += netCad;

      // Track by currency
      const currency = (expense.original_currency || expense.currency || "CAD").toUpperCase();
      if (currency === "USD") {
        by_currency.usd.original_total += expense.original_amount || 0;
        by_currency.usd.converted_cad += cadAmount;
        by_currency.usd.net_converted_cad += netCad;
        by_currency.usd.count += 1;
      } else {
        by_currency.cad.original_total += expense.original_amount || cadAmount || 0;
        by_currency.cad.net_total_cad += netCad;
        by_currency.cad.count += 1;
      }

      // Calculate GST, HST, and PST separately
      // BACKWARD COMPATIBILITY: If gst_amount is 0 or not set, but tax_amount has a value,
      // use tax_amount as GST (for Canadian receipts, tax was typically GST/HST)
      const gstAmount = expense.gst_amount || 0;
      const hstAmount = expense.hst_amount || 0;
      const pstAmount = expense.pst_amount || 0;

      // If no separate values, use tax_amount as HST (backward compatibility)
      const effectiveGst = gstAmount;
      const effectiveHst = (gstAmount === 0 && hstAmount === 0 && expense.tax_amount)
        ? expense.tax_amount
        : hstAmount;
      const effectivePst = pstAmount;

      totals.total_gst += effectiveGst;
      totals.total_hst += effectiveHst;
      totals.total_pst += effectivePst;
      totals.total_tax += effectiveGst + effectiveHst + effectivePst;

      totals.total_tax_recoverable += itcCad;

      // Calculate deductible amount for T2125
      const deductibleAmount = calculateDeductibleAmount(expense);
      totals.total_potential_deductions += deductibleAmount;

      // By category
      const cat = expense.category || "uncategorized";
      if (!by_category[cat]) {
        by_category[cat] = {
          total_cad: 0,
          total_net_cad: 0,
          total_itc_cad: 0,
          count: 0,
          total_deductible: 0,
          total_gst: 0,
          total_hst: 0,
          total_pst: 0,
          total_tax: 0,
        };
      }
      by_category[cat].total_cad += cadAmount;
      by_category[cat].total_net_cad += netCad;
      by_category[cat].total_itc_cad += itcCad;
      by_category[cat].count += 1;
      by_category[cat].total_deductible += deductibleAmount;
      by_category[cat].total_gst += effectiveGst;
      by_category[cat].total_hst += effectiveHst;
      by_category[cat].total_pst += effectivePst;
      by_category[cat].total_tax += effectiveGst + effectiveHst + effectivePst;

      // By payment source (net of ITC, aligned with dashboard Total Expenses)
      if (expense.payment_source === "personal_card") {
        by_payment_source.due_to_shareholder += netCad;
      } else if (expense.payment_source === "company_card") {
        by_payment_source.company_expenses += netCad;
      } else if (expense.payment_source === "bank_checking") {
        by_payment_source.bank_checking += netCad;
      } else if (expense.payment_source === "e_transfer") {
        by_payment_source.e_transfer += netCad;
      } else {
        by_payment_source.unknown += netCad;
      }
    });

    // Calculate 50% deductible for meals (CRA rule)
    const mealsTotal = by_category["meals_entertainment"]?.total_cad || 0;
    totals.meals_50_percent = mealsTotal * 0.5;

    // Calculate average exchange rate for USD expenses
    if (by_currency.usd.count > 0 && by_currency.usd.original_total > 0) {
      by_currency.usd.avg_rate = by_currency.usd.converted_cad / by_currency.usd.original_total;
    }
    by_currency.cad.net_total_cad =
      Math.round(by_currency.cad.net_total_cad * 100) / 100;
    by_currency.usd.net_converted_cad =
      Math.round(by_currency.usd.net_converted_cad * 100) / 100;

    const ccaYear = fullCalendarYearFromRange(params?.start_date, params?.end_date);
    let ccaDeduction = 0;
    if (ccaYear !== null && listAssetsForSummary) {
      try {
        const assetRows = await listAssetsForSummary();
        ccaDeduction = Math.round(getTotalCCAForYear(assetRows, ccaYear) * 100) / 100;
      } catch {
        ccaDeduction = 0;
      }
    }
    totals.cca_deduction_cad = ccaDeduction;
    totals.cca_fiscal_year = ccaYear;
    totals.total_net_expense_cad =
      Math.round(totals.total_net_expense_cad * 100) / 100;
    totals.total_pnl_expense_cad =
      Math.round((totals.total_net_expense_cad + totals.cca_deduction_cad) * 100) / 100;

    return { totals, by_category, by_payment_source, by_currency };
  },
};

// ============ ASSETS (CCA / Capital Cost Allowance) ============

const ASSETS_COLLECTION = "assets";

export type { CCAAsset, CCAAssetCategory, CCAAssetStatus, UCCScheduleEntry };

export const assetsApi = {
  /**
   * Create a new asset
   */
  create: async (asset: Partial<CCAAsset>): Promise<string> => {
    await ensureAuth();
    const now = new Date();

    // Calculate adjusted cost (apply class 10.1 ceiling etc.)
    const adjustedCost = getAdjustedCost(
      asset.purchase_cost || 0,
      asset.cca_class || "class_10",
    );

    // Get purchase year
    const purchaseDate =
      asset.purchase_date instanceof Date
        ? asset.purchase_date
        : new Date(asset.purchase_date || now);
    const purchaseYear = purchaseDate.getFullYear();

    // Generate initial UCC schedule (purchase year to current year + 5)
    const currentYear = new Date().getFullYear();
    const toYear = Math.max(currentYear + 5, purchaseYear + 10);
    const schedule = generateUCCSchedule(
      asset.purchase_cost || 0,
      asset.cca_class || "class_10",
      purchaseYear,
      toYear,
    );

    const docRef = await addDoc(collection(db, ASSETS_COLLECTION), {
      name: asset.name || "",
      description: asset.description || "",
      cca_class: asset.cca_class || "class_10",
      purchase_date: toISODateString(purchaseDate) || "",
      purchase_cost: asset.purchase_cost || 0,
      adjusted_cost: adjustedCost,
      vendor_name: asset.vendor_name || "",
      category: asset.category || "other",
      status: asset.status || "active",
      disposal_date: null,
      disposal_proceeds: 0,
      ucc_schedule: schedule,
      linked_expense_id: asset.linked_expense_id || null,
      linked_bank_fingerprint: asset.linked_bank_fingerprint || null,
      receipt_image_url: asset.receipt_image_url || null,
      notes: asset.notes || "",
      created_at: Timestamp.fromDate(now),
      updated_at: Timestamp.fromDate(now),
    });

    return docRef.id;
  },

  /**
   * Get asset by ID
   */
  get: async (id: string): Promise<CCAAsset | null> => {
    await ensureAuth();
    const docRef = doc(db, ASSETS_COLLECTION, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return null;

    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      purchase_date: data.purchase_date ? toDate(data.purchase_date) : new Date(),
      disposal_date: data.disposal_date ? toDate(data.disposal_date) : null,
      created_at: toDate(data.created_at),
      updated_at: toDate(data.updated_at),
    } as CCAAsset;
  },

  /**
   * List all assets
   */
  list: async (): Promise<CCAAsset[]> => {
    await ensureAuth();
    const q = query(
      collection(db, ASSETS_COLLECTION),
      orderBy("created_at", "desc"),
    );
    const querySnapshot = await getDocs(q);
    const assets: CCAAsset[] = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      assets.push({
        id: docSnap.id,
        ...data,
        purchase_date: data.purchase_date ? toDate(data.purchase_date) : new Date(),
        disposal_date: data.disposal_date ? toDate(data.disposal_date) : null,
        created_at: toDate(data.created_at),
        updated_at: toDate(data.updated_at),
      } as CCAAsset);
    });

    return assets;
  },

  /**
   * Update an asset
   */
  update: async (id: string, data: Partial<CCAAsset>): Promise<void> => {
    await ensureAuth();
    const docRef = doc(db, ASSETS_COLLECTION, id);

    const updateData: Record<string, any> = {
      ...data,
      updated_at: Timestamp.fromDate(new Date()),
    };

    // If purchase_cost or cca_class changed, recalculate schedule
    if (data.purchase_cost !== undefined || data.cca_class !== undefined) {
      const existing = await assetsApi.get(id);
      if (existing) {
        const cost = data.purchase_cost ?? existing.purchase_cost;
        const classId = data.cca_class ?? existing.cca_class;
        const purchaseDate =
          (data.purchase_date || existing.purchase_date) instanceof Date
            ? (data.purchase_date || existing.purchase_date) as Date
            : new Date((data.purchase_date || existing.purchase_date) as string);
        const purchaseYear = purchaseDate.getFullYear();
        const currentYear = new Date().getFullYear();
        const toYear = Math.max(currentYear + 5, purchaseYear + 10);

        updateData.adjusted_cost = getAdjustedCost(cost, classId);
        updateData.ucc_schedule = generateUCCSchedule(cost, classId, purchaseYear, toYear);
      }
    }

    await updateDoc(docRef, updateData);
  },

  /**
   * Delete an asset
   */
  delete: async (id: string): Promise<void> => {
    await ensureAuth();
    const docRef = doc(db, ASSETS_COLLECTION, id);
    await deleteDoc(docRef);
  },

  /**
   * Convert an existing expense to an asset.
   * - Creates new asset document with CCA class
   * - Marks original expense as reclassified
   * - Preserves audit trail
   */
  convertFromExpense: async (
    expenseId: string,
    ccaClass: string,
    assetName: string,
    assetCategory: CCAAssetCategory,
  ): Promise<string> => {
    await ensureAuth();

    // 1. Fetch the expense
    const expense = await expensesApi.get(expenseId);
    if (!expense) throw new Error("Expense not found");

    const purchaseCost = expense.cad_amount || expense.original_amount || 0;
    const purchaseDate = expense.transaction_date || new Date();

    // 2. Create asset record
    const assetId = await assetsApi.create({
      name: assetName,
      description: `Converted from expense: ${expense.vendor_name} — ${purchaseCost.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD`,
      cca_class: ccaClass,
      purchase_date: purchaseDate,
      purchase_cost: purchaseCost,
      vendor_name: expense.vendor_name || "",
      category: assetCategory,
      status: "active",
      linked_expense_id: expenseId,
      linked_bank_fingerprint: expense.import_fingerprint || null,
      receipt_image_url: expense.receipt_image_url || null,
      notes: `Reclassified from expense on ${new Date().toISOString().split("T")[0]}. Original category: ${expense.category}`,
    });

    // 3. Mark expense as reclassified (keep category for bank/receipt audit; excluded from P&L via flag)
    await expensesApi.update(expenseId, {
      reclassified_to_asset: true,
      notes: `[RECLASSIFIED TO ASSET] Asset ID: ${assetId}. Original amount: ${purchaseCost.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD. This expense has been reclassified as a depreciable asset for CRA compliance.${expense.notes ? ` | Original notes: ${expense.notes}` : ""}`,
      is_verified: true,
    } as any);

    return assetId;
  },

  /**
   * Get CCA report for a fiscal year
   */
  getCCAReport: async (
    fiscalYear: number,
  ): Promise<{
    assets: Array<CCAAsset & { ccaForYear: number; uccBalance: number }>;
    totalCCA: number;
    totalAssetValue: number;
    totalUCC: number;
  }> => {
    const assets = await assetsApi.list();
    const activeAssets = assets.filter((a) => a.status === "active");

    const assetsWithCCA = activeAssets.map((asset) => ({
      ...asset,
      ccaForYear: getCCAForYear(asset, fiscalYear),
      uccBalance: getUCCBalance(asset, fiscalYear),
    }));

    const totalCCA = assetsWithCCA.reduce((sum, a) => sum + a.ccaForYear, 0);
    const totalAssetValue = assetsWithCCA.reduce(
      (sum, a) => sum + a.purchase_cost,
      0,
    );
    const totalUCC = assetsWithCCA.reduce((sum, a) => sum + a.uccBalance, 0);

    return {
      assets: assetsWithCCA,
      totalCCA: Math.round(totalCCA * 100) / 100,
      totalAssetValue: Math.round(totalAssetValue * 100) / 100,
      totalUCC: Math.round(totalUCC * 100) / 100,
    };
  },

  /**
   * Scan existing expenses for potential asset candidates
   */
  scanForAssetCandidates: async (): Promise<
    Array<{
      expense: Expense;
      reason: string;
      suggestedClasses: string[];
      suggestedCategory: CCAAssetCategory;
    }>
  > => {
    await ensureAuth();
    const allExpResult = await expensesApi.list({ per_page: 2000 });
    const candidates: Array<{
      expense: Expense;
      reason: string;
      suggestedClasses: string[];
      suggestedCategory: CCAAssetCategory;
    }> = [];

    for (const expense of allExpResult.expenses) {
      if (isExpenseReclassifiedToAsset(expense)) continue;
      if (isExcludedFromBusinessPl(expense)) continue;

      const amount = expense.cad_amount || expense.original_amount || 0;
      const result = detectAssetCandidate(
        amount,
        expense.vendor_name || "",
        expense.category,
        expense.notes || "",
      );

      if (result && result.isAssetCandidate) {
        candidates.push({
          expense,
          reason: result.reason,
          suggestedClasses: result.suggestedClasses,
          suggestedCategory: result.suggestedCategory,
        });
      }
    }

    return candidates;
  },
};

listAssetsForSummary = () => assetsApi.list();

