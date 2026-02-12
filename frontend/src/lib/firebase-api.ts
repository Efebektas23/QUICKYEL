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
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import * as XLSX from "xlsx";

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
  exchange_rate: number;
  cad_amount: number | null;
  card_last_4: string | null;
  payment_source: string;
  receipt_image_url: string | null;
  receipt_image_urls?: string[];  // Multiple images support
  raw_ocr_text: string | null;
  is_verified: boolean;
  processing_status: string;
  error_message: string | null;
  notes: string | null;
  entry_type?: "ocr" | "manual";  // Track how the expense was entered
  proof_image_url?: string | null;  // Bank screenshot or other proof for manual entries
  created_at: Date;
  updated_at: Date;
}

export interface Card {
  id?: string;
  last_four: string;
  card_name: string;
  is_company_card: boolean;
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
   * Verify expense
   */
  verify: async (id: string): Promise<void> => {
    const docRef = doc(db, EXPENSES_COLLECTION, id);
    await updateDoc(docRef, {
      is_verified: true,
      updated_at: Timestamp.fromDate(new Date()),
    });
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
    
    const docRef = doc(db, EXPENSES_COLLECTION, id);
    await deleteDoc(docRef);
  },

  /**
   * Upload multiple receipt images and process with backend AI
   * For long receipts that need multiple photos
   */
  uploadMultiple: async (files: File[]): Promise<Expense> => {
    console.log(`📤 Starting upload for ${files.length} file(s)`);
    
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
      const response = await fetch(`${API_URL}/api/process-receipt/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_id: expenseId,
          image_url: imageUrls[0],
          image_urls: imageUrls, // Send all URLs for multi-image processing
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Backend processing failed");
      }
      
      const result = await response.json();
      console.log("✅ Backend processing complete:", result);
      
      // 4. Update expense with parsed data
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
        exchange_rate: result.exchange_rate || 1.0,
        cad_amount: result.cad_amount || result.total_amount,
        card_last_4: result.card_last_4,
        raw_ocr_text: result.raw_text,
        processing_status: "completed",
      });
      
      return (await expensesApi.get(expenseId))!;
      
    } catch (error: any) {
      console.error("❌ Processing error:", error);
      await expensesApi.update(expenseId, {
        processing_status: "error",
        error_message: error.message,
      });
      throw error;
    }
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
      const response = await fetch(`${API_URL}/api/process-receipt/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_id: expenseId,
          image_url: imageUrl,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Backend processing failed");
      }
      
      const result = await response.json();
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

  create: async (data: { last_four: string; card_name: string; is_company_card: boolean }): Promise<string> => {
    const docRef = await addDoc(collection(db, CARDS_COLLECTION), {
      ...data,
      created_at: Timestamp.fromDate(new Date()),
    });
    return docRef.id;
  },

  delete: async (id: string): Promise<void> => {
    const docRef = doc(db, CARDS_COLLECTION, id);
    await deleteDoc(docRef);
  },
};

// ============ REVENUE ============

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
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      
      console.log("🌐 Response status:", response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("🌐 Error response body:", errorText);
        throw new Error(`Backend error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
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
   * Fetch Bank of Canada exchange rate for a specific date
   * Uses the official Bank of Canada Valet API for accurate CRA-compliant rates
   * If the date is a weekend/holiday, finds the closest business day BEFORE that date
   */
  fetchExchangeRate: async (date: Date): Promise<number> => {
    try {
      // Format date as YYYY-MM-DD
      const dateStr = date.toISOString().split('T')[0];
      
      console.log(`🏦 Bank of Canada: Fetching exchange rate for ${dateStr}...`);
      
      // Bank of Canada Valet API - try exact date first
      const apiUrl = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${dateStr}&end_date=${dateStr}`;
      console.log(`🏦 API URL: ${apiUrl}`);
      
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
      
      // If no rate for that date (weekend/holiday), look back up to 7 days to find the closest business day
      console.log(`🏦 ⚠️ No rate for ${dateStr} (weekend/holiday), searching previous business days...`);
      
      // Calculate a date range: from 7 days before to the target date
      const endDate = new Date(date);
      const startDate = new Date(date);
      startDate.setDate(startDate.getDate() - 7);
      
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const rangeUrl = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${startDateStr}&end_date=${endDateStr}`;
      console.log(`🏦 Range API URL: ${rangeUrl}`);
      
      const rangeResponse = await fetch(rangeUrl);
      
      if (rangeResponse.ok) {
        const rangeData = await rangeResponse.json();
        if (rangeData.observations && rangeData.observations.length > 0) {
          // Get the LAST (most recent) observation in the range - closest to target date
          const lastObs = rangeData.observations[rangeData.observations.length - 1];
          const rate = parseFloat(lastObs.FXUSDCAD.v);
          const rateDate = lastObs.d;
          console.log(`🏦 ✅ Closest business day rate (${rateDate}): 1 USD = ${rate} CAD`);
          return rate;
        }
      }
      
      // If still no data, use the most recent available rate (for very old dates)
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
      
      // Default fallback rate
      console.warn(`🏦 ⚠️ Using fallback rate: 1.40`);
      return 1.40;
    } catch (error) {
      console.error("🏦 ❌ Error fetching exchange rate:", error);
      return 1.40; // Fallback rate
    }
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
  type: "expense" | "income" | "transfer" | "owner_draw";
  category: string;
  payment_source: string;
  vendor_name: string;
  notes: string;
  confidence: number;
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
    const response = await fetch(`${API_URL}/api/bank-import/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_content: csvContent }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "Failed to parse bank CSV");
    }

    return response.json();
  },

  /**
   * Import selected bank transactions as expenses/revenue into Firestore.
   * Includes duplicate prevention - checks fingerprints before importing.
   */
  importTransactions: async (transactions: BankTransaction[]): Promise<{
    expenses_created: number;
    revenues_created: number;
    skipped: number;
    duplicates_skipped: number;
  }> => {
    await ensureAuth();
    const now = new Date();
    let expenses_created = 0;
    let revenues_created = 0;
    let skipped = 0;
    let duplicates_skipped = 0;

    // Generate fingerprints for all transactions
    const fingerprints = transactions.map((tx) => bankTransactionFingerprint(tx));

    // Check which ones already exist
    const existingFingerprints = await duplicateCheckApi.checkTransactionFingerprints(fingerprints);

    const newFingerprints: string[] = [];

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      const fp = fingerprints[i];

      // Skip duplicates
      if (existingFingerprints.has(fp)) {
        duplicates_skipped++;
        continue;
      }

      try {
        if (tx.type === "expense") {
          // Determine if this is a USD or CAD transaction
          const isUsd = !tx.amount_cad && tx.amount_usd != null && tx.amount_usd !== 0;
          const originalAmount = Math.abs(isUsd ? (tx.amount_usd || 0) : (tx.amount_cad || 0));
          const currency = isUsd ? "USD" : "CAD";
          
          let exchangeRate = 1.0;
          let cadAmount = originalAmount;
          
          if (isUsd) {
            // Fetch Bank of Canada exchange rate for the transaction date
            try {
              const txDate = tx.transaction_date ? new Date(tx.transaction_date) : new Date();
              exchangeRate = await revenueApi.fetchExchangeRate(txDate);
              cadAmount = Math.round(originalAmount * exchangeRate * 100) / 100;
            } catch {
              exchangeRate = 1.40; // Fallback
              cadAmount = Math.round(originalAmount * exchangeRate * 100) / 100;
            }
          }

          await addDoc(collection(db, EXPENSES_COLLECTION), {
            vendor_name: tx.vendor_name || tx.description1,
            transaction_date: tx.transaction_date,
            category: tx.category || "uncategorized",
            jurisdiction: isUsd ? "usa" : "canada",
            original_amount: originalAmount,
            original_currency: currency,
            tax_amount: 0,
            gst_amount: 0,
            hst_amount: 0,
            pst_amount: 0,
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
            created_at: Timestamp.fromDate(now),
            updated_at: Timestamp.fromDate(now),
          });
          expenses_created++;
          newFingerprints.push(fp);
        } else if (tx.type === "income") {
          // Determine if this is a USD or CAD transaction
          const isUsd = !tx.amount_cad && tx.amount_usd != null && tx.amount_usd !== 0;
          const originalAmount = Math.abs(isUsd ? (tx.amount_usd || 0) : (tx.amount_cad || 0));
          const currency = isUsd ? "USD" : "CAD";
          
          let exchangeRate = 1.0;
          let cadAmount = originalAmount;
          
          if (isUsd) {
            try {
              const txDate = tx.transaction_date ? new Date(tx.transaction_date) : new Date();
              exchangeRate = await revenueApi.fetchExchangeRate(txDate);
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

    return { expenses_created, revenues_created, skipped, duplicates_skipped };
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
    const response = await fetch(`${API_URL}/api/factoring/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdf_base64: base64,
        filename: file.name,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "Failed to parse factoring report");
    }

    return response.json();
  },

  /**
   * Import selected factoring entries as expenses into Firestore.
   * Includes duplicate prevention - checks fingerprints before importing.
   */
  importEntries: async (
    entries: FactoringEntry[],
    currency: string,
    exchangeRate: number
  ): Promise<{
    expenses_created: number;
    skipped: number;
    duplicates_skipped: number;
  }> => {
    await ensureAuth();
    const now = new Date();
    let expenses_created = 0;
    let skipped = 0;
    let duplicates_skipped = 0;

    // Generate fingerprints for all entries
    const fingerprints = entries.map((entry) => factoringEntryFingerprint(entry));

    // Check which ones already exist
    const existingFingerprints = await duplicateCheckApi.checkTransactionFingerprints(fingerprints);

    const newFingerprints: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fp = fingerprints[i];

      // Skip duplicates
      if (existingFingerprints.has(fp)) {
        duplicates_skipped++;
        continue;
      }

      try {
        // Only import fee entries as expenses
        if (entry.type === "fee" || entry.category === "factoring_fees") {
          const amount = Math.abs(entry.amount);
          const cadAmount = currency === "CAD" ? amount : amount * exchangeRate;

          await addDoc(collection(db, EXPENSES_COLLECTION), {
            vendor_name: "J D Factors",
            transaction_date: entry.date || null,
            category: "factoring_fees",
            jurisdiction: "canada",
            original_amount: amount,
            original_currency: currency,
            tax_amount: 0,
            gst_amount: 0,
            hst_amount: 0,
            pst_amount: 0,
            exchange_rate: currency === "CAD" ? 1.0 : exchangeRate,
            cad_amount: Math.round(cadAmount * 100) / 100,
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

    return { expenses_created, skipped, duplicates_skipped };
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
    
    // CSV Header
    const headers = [
      "Date",
      "Vendor",
      "Category",
      "Original Currency",
      "Original Amount",
      "Exchange Rate",
      "CAD Amount",
      "GST/HST (ITC)",
      "Payment Source",
      "Due to Shareholder",
      "Jurisdiction",
      "Receipt Link",
      "Notes"
    ];
    
    // CSV Rows
    const rows = expenses.map(expense => {
      const paymentSource = expense.payment_source === "personal_card" ? "Personal Card" : 
                           expense.payment_source === "company_card" ? "Company Card" : 
                           expense.payment_source === "bank_checking" ? "Bank / Checking" :
                           expense.payment_source === "e_transfer" ? "e-Transfer" : "Unknown";
      const dueToShareholder = expense.payment_source === "personal_card" ? "Yes" : "No";
      const jurisdiction = expense.jurisdiction === "canada" ? "CANADA" : 
                          expense.jurisdiction === "usa" ? "USA" : "UNKNOWN";
      const taxAmount = (expense.gst_amount && expense.gst_amount > 0) ? expense.gst_amount : (expense.tax_amount || 0);
      
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
        taxAmount.toFixed(2),
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
    
    // ===== SUMMARY =====
    const totalExpensesCAD = expenses.reduce((sum, e) => sum + (e.cad_amount || 0), 0);
    const totalRevenueCAD = revenues.reduce((sum, r) => sum + (r.amount_cad || 0), 0);
    const netProfit = totalRevenueCAD - totalExpensesCAD;
    const totalGST = expenses.reduce((sum, e) => {
      const gst = (e.gst_amount && e.gst_amount > 0) ? e.gst_amount : (e.tax_amount || 0);
      return sum + gst;
    }, 0);
    
    const summaryCsv = [
      "",
      "=== SUMMARY ===",
      `"Gross Revenue (CAD)","${totalRevenueCAD.toFixed(2)}"`,
      `"Total Expenses (CAD)","${totalExpensesCAD.toFixed(2)}"`,
      `"Net Profit (CAD)","${netProfit.toFixed(2)}"`,
      `"Recoverable GST/HST (ITC)","${totalGST.toFixed(2)}"`,
      `"Expense Count","${expenses.length}"`,
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
    
    // Prepare data for Excel with separate tax columns
    const excelData = expenses.map(expense => {
      const category = expense.category || "uncategorized";
      const deductionRate = DEDUCTION_RATES[category] ?? 0.0;
      const deductibleAmount = (expense.cad_amount || 0) * deductionRate;
      
      // Get separate tax amounts with backward compatibility
      const gstAmount = expense.gst_amount || 0;
      const hstAmount = expense.hst_amount || 0;
      const pstAmount = expense.pst_amount || 0;
      
      // Backward compatibility: if no separate values, use tax_amount as HST
      const effectiveHst = (gstAmount === 0 && hstAmount === 0 && expense.tax_amount) 
        ? expense.tax_amount 
        : hstAmount;
      const totalTax = gstAmount + effectiveHst + pstAmount;
      const taxRecoverable = gstAmount + effectiveHst; // Only GST + HST are ITC recoverable
      
      // Payment source logic
      const paymentSource = expense.payment_source === "company_card" ? "Company Card" 
        : expense.payment_source === "personal_card" ? "Personal Card"
        : expense.payment_source === "bank_checking" ? "Bank / Checking"
        : expense.payment_source === "e_transfer" ? "e-Transfer"
        : "Unknown";
      const dueToShareholder = expense.payment_source === "personal_card" 
        ? expense.cad_amount || 0 
        : 0;
      
      // Jurisdiction
      const jurisdiction = expense.currency === "USD" ? "USA" : "Canada";
      
      // Notes
      const notes = deductionRate < 1.0 
        ? `${(deductionRate * 100).toFixed(0)}% deductible` 
        : "";
      
      return {
        "Date": formatExportDate(expense.transaction_date),
        "Vendor": expense.vendor_name || "",
        "Category": category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        "Original Amount": expense.original_amount || expense.cad_amount || 0,
        "Currency": expense.currency || "CAD",
        "Exchange Rate": expense.exchange_rate !== 1.0 ? expense.exchange_rate?.toFixed(4) : "N/A",
        "CAD Amount": expense.cad_amount || 0,
        "GST (5%)": gstAmount,
        "HST (13-15%)": effectiveHst,
        "PST (6-10%)": pstAmount,
        "Total Tax": totalTax,
        "Tax Recoverable (ITC)": taxRecoverable,
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
      { wch: 10 },  // GST (5%)
      { wch: 12 },  // HST (13-15%)
      { wch: 10 },  // PST (6-10%)
      { wch: 10 },  // Total Tax
      { wch: 15 },  // Tax Recoverable
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
    
    // ===== SUMMARY SHEET =====
    const totalExpensesCAD = expenses.reduce((sum, e) => sum + (e.cad_amount || 0), 0);
    const totalGST = expenses.reduce((sum, e) => sum + (e.gst_amount || 0), 0);
    const totalHST = expenses.reduce((sum, e) => {
      // Backward compatibility: use tax_amount if no separate hst_amount
      const hst = e.hst_amount || 0;
      const backwardHst = (e.gst_amount === 0 && hst === 0 && e.tax_amount) ? e.tax_amount : hst;
      return sum + backwardHst;
    }, 0);
    const totalPST = expenses.reduce((sum, e) => sum + (e.pst_amount || 0), 0);
    const totalTaxRecoverable = totalGST + totalHST; // Only GST + HST are ITC recoverable
    const totalDeductible = expenses.reduce((sum, e) => {
      const cat = e.category || "uncategorized";
      const rate = DEDUCTION_RATES[cat] ?? 0.0;
      return sum + (e.cad_amount || 0) * rate;
    }, 0);
    const totalRevenueCAD = revenues.reduce((sum, r) => sum + (r.amount_cad || 0), 0);
    const netProfit = totalRevenueCAD - totalExpensesCAD;
    
    const summaryData = [
      { "Metric": "Gross Revenue (CAD)", "Value": totalRevenueCAD.toFixed(2) },
      { "Metric": "Total Expenses (CAD)", "Value": totalExpensesCAD.toFixed(2) },
      { "Metric": "Net Profit (CAD)", "Value": netProfit.toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "GST (5%) - Federal Tax", "Value": totalGST.toFixed(2) },
      { "Metric": "HST (13-15%) - Harmonized Tax", "Value": totalHST.toFixed(2) },
      { "Metric": "PST (6-10%) - Provincial Tax", "Value": totalPST.toFixed(2) },
      { "Metric": "Total GST+HST Recoverable (ITC)", "Value": totalTaxRecoverable.toFixed(2) },
      { "Metric": "Total All Taxes", "Value": (totalGST + totalHST + totalPST).toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "Tax Deductions (T2125)", "Value": totalDeductible.toFixed(2) },
      { "Metric": "", "Value": "" },
      { "Metric": "Total Expense Count", "Value": expenses.length.toString() },
      { "Metric": "Total Revenue Count", "Value": revenues.length.toString() },
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
      total_cad: 0,
      expense_count: expenses.expenses.length,
      total_tax_recoverable: 0,
      total_gst: 0,   // GST only (5%) - ITC recoverable
      total_hst: 0,   // HST only (13-15%) - ITC recoverable
      total_pst: 0,   // PST only (6-10%) - NOT recoverable
      total_tax: 0,   // Sum of GST + HST + PST
      total_potential_deductions: 0,  // T2125 tax deductions
      meals_50_percent: 0,  // 50% deductible portion of meals
    };
    
    const by_category: Record<string, { total_cad: number; count: number; total_deductible: number; total_gst: number; total_hst: number; total_pst: number; total_tax: number }> = {};
    const by_payment_source: Record<string, number> = {
      company_expenses: 0,
      due_to_shareholder: 0,
      bank_checking: 0,
      e_transfer: 0,
      unknown: 0,
    };
    // Currency breakdown for expenses
    const by_currency = {
      cad: { original_total: 0, count: 0 },
      usd: { original_total: 0, converted_cad: 0, count: 0, avg_rate: 0 },
    };
    
    expenses.expenses.forEach((expense) => {
      const cadAmount = expense.cad_amount || 0;
      totals.total_cad += cadAmount;
      
      // Track by currency
      const currency = (expense.original_currency || expense.currency || "CAD").toUpperCase();
      if (currency === "USD") {
        by_currency.usd.original_total += expense.original_amount || 0;
        by_currency.usd.converted_cad += cadAmount;
        by_currency.usd.count += 1;
      } else {
        by_currency.cad.original_total += expense.original_amount || cadAmount || 0;
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
      
      // Only GST + HST are ITC recoverable (not PST)
      totals.total_tax_recoverable += effectiveGst + effectiveHst;
      
      // Calculate deductible amount for T2125
      const deductibleAmount = calculateDeductibleAmount(expense);
      totals.total_potential_deductions += deductibleAmount;
      
      // By category
      const cat = expense.category || "uncategorized";
      if (!by_category[cat]) {
        by_category[cat] = { total_cad: 0, count: 0, total_deductible: 0, total_gst: 0, total_hst: 0, total_pst: 0, total_tax: 0 };
      }
      by_category[cat].total_cad += cadAmount;
      by_category[cat].count += 1;
      by_category[cat].total_deductible += deductibleAmount;
      by_category[cat].total_gst += effectiveGst;
      by_category[cat].total_hst += effectiveHst;
      by_category[cat].total_pst += effectivePst;
      by_category[cat].total_tax += effectiveGst + effectiveHst + effectivePst;
      
      // By payment source
      if (expense.payment_source === "personal_card") {
        by_payment_source.due_to_shareholder += cadAmount;
      } else if (expense.payment_source === "company_card") {
        by_payment_source.company_expenses += cadAmount;
      } else if (expense.payment_source === "bank_checking") {
        by_payment_source.bank_checking += cadAmount;
      } else if (expense.payment_source === "e_transfer") {
        by_payment_source.e_transfer += cadAmount;
      } else {
        by_payment_source.unknown += cadAmount;
      }
    });
    
    // Calculate 50% deductible for meals (CRA rule)
    const mealsTotal = by_category["meals_entertainment"]?.total_cad || 0;
    totals.meals_50_percent = mealsTotal * 0.5;
    
    // Calculate average exchange rate for USD expenses
    if (by_currency.usd.count > 0 && by_currency.usd.original_total > 0) {
      by_currency.usd.avg_rate = by_currency.usd.converted_cad / by_currency.usd.original_total;
    }
    
    return { totals, by_category, by_payment_source, by_currency };
  },
};

