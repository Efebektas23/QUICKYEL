/**
 * BC operating expense assumptions: recoverable ITC is 5% GST only; PST stays in the expense.
 * Used for dashboard net-of-GST totals and automatic ITC estimation when tax lines were not entered.
 */

const EPS = 1e-6;

/** Minimal expense shape for tax helpers (avoids circular imports with firebase-api). */
export type ExpenseTaxFields = {
  cad_amount?: number | null;
  category?: string;
  jurisdiction?: string;
  original_currency?: string;
  currency?: string;
  gst_amount?: number;
  hst_amount?: number;
  pst_amount?: number;
  tax_amount?: number;
};

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Categories that typically include only 5% GST on top of the principal (BC). */
const GST_ONLY_5: Set<string> = new Set([
  "subcontractor",
  "professional_fees",
  "fuel",
]);

/** Gross includes 12% tax; extract 5% GST portion for ITC (PST remains in expense). */
const GST_FROM_12_PCT: Set<string> = new Set([
  "maintenance_repairs",
  "office_admin",
  "rent_lease",
]);

/** No GST / exempt for ITC purposes. */
const ITC_ZERO: Set<string> = new Set([
  "tolls_scales",
  "factoring_fees",
  "insurance",
  "loan_interest",
  "payroll",
  "travel_lodging",
  "personal",
  "other_expenses",
  "uncategorized",
  "licenses_dues",
  "meals_entertainment", // handled separately (50% ITC rule)
]);

/**
 * Estimated recoverable GST (ITC) in CAD from gross, before rounding.
 * Meals: 50% of embedded 5% GST per CRA M&E ITC limitation.
 */
export function estimateBcRecoverableItcRaw(
  category: string,
  grossCad: number,
): number {
  if (!grossCad || grossCad <= 0) return 0;
  const cat = (category || "uncategorized").toLowerCase();

  if (cat === "meals_entertainment") {
    const fullGst = grossCad - grossCad / 1.05;
    return fullGst * 0.5;
  }
  if (GST_ONLY_5.has(cat)) {
    return grossCad - grossCad / 1.05;
  }
  if (GST_FROM_12_PCT.has(cat)) {
    return (grossCad / 1.12) * 0.05;
  }
  if (ITC_ZERO.has(cat)) {
    return 0;
  }
  return 0;
}

export function estimateBcRecoverableItcCad(category: string, grossCad: number): number {
  return roundMoney(estimateBcRecoverableItcRaw(category, grossCad));
}

/** True if any tax field was populated (manual entry, OCR, or legacy total tax). */
export function expenseHasManualOrParsedTax(e: Pick<ExpenseTaxFields, "gst_amount" | "hst_amount" | "pst_amount" | "tax_amount">): boolean {
  const gst = e.gst_amount ?? 0;
  const hst = e.hst_amount ?? 0;
  const pst = e.pst_amount ?? 0;
  const tax = e.tax_amount ?? 0;
  return (
    gst > EPS || hst > EPS || pst > EPS || tax > EPS
  );
}

export function isCanadaJurisdiction(j: string | undefined): boolean {
  return (j || "").toLowerCase() === "canada";
}

/**
 * True when Canadian GST/HST/PST must never be inferred (US spend / USD native).
 * CAD amount may exist from FX — ITC still zero for CRA.
 */
export function shouldBypassCanadianItcEstimation(
  originalCurrency: string | undefined,
  jurisdiction: string | undefined,
): boolean {
  const cur = (originalCurrency || "CAD").toUpperCase();
  const jur = (jurisdiction || "").toLowerCase();
  if (cur === "USD") return true;
  if (jur === "usa" || jur === "us") return true;
  return false;
}

/**
 * Persisted ITC estimate for CAD operating expenses (BC rules).
 * Returns null for USD, USA jurisdiction, or non-Canada jurisdiction.
 */
export function computeBcItcAutoFieldsFromGross(
  category: string | undefined,
  grossCad: number,
  jurisdiction: string | undefined,
  originalCurrency: string | undefined,
): { gst_amount: number; tax_amount: number; gst_itc_estimated: boolean } | null {
  if (grossCad <= 0) return null;
  if (shouldBypassCanadianItcEstimation(originalCurrency, jurisdiction)) return null;
  if (!isCanadaJurisdiction(jurisdiction)) return null;
  const cat = category || "uncategorized";
  const gst = estimateBcRecoverableItcCad(cat, grossCad);
  return {
    gst_amount: gst,
    tax_amount: gst,
    gst_itc_estimated: true,
  };
}

export type ExpenseItcMeta = ExpenseTaxFields & { gst_itc_estimated?: boolean };

/**
 * Category change: recalc stored ITC only when the row is system-estimated or still has no manual/OCR tax.
 */
export function mergeBcItcForCategoryChange(
  existing: ExpenseItcMeta,
  newCategory: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { category: newCategory };
  const cur = existing.original_currency || existing.currency;
  if (shouldBypassCanadianItcEstimation(cur, existing.jurisdiction)) {
    if (existing.gst_itc_estimated === true) {
      Object.assign(out, {
        gst_amount: 0,
        hst_amount: 0,
        tax_amount: 0,
        gst_itc_estimated: false,
      });
    }
    return out;
  }
  if (existing.gst_itc_estimated === false) {
    return out;
  }
  if (existing.gst_itc_estimated === true) {
    const itc = computeBcItcAutoFieldsFromGross(
      newCategory,
      existing.cad_amount ?? 0,
      existing.jurisdiction,
      cur,
    );
    if (itc) Object.assign(out, itc);
    return out;
  }
  if (expenseHasManualOrParsedTax(existing)) {
    return out;
  }
  const itc = computeBcItcAutoFieldsFromGross(
    newCategory,
    existing.cad_amount ?? 0,
    existing.jurisdiction,
    cur,
  );
  if (itc) Object.assign(out, itc);
  return out;
}

/** GST+HST stored or inferred for legacy rows (tax_amount → HST). */
export function getEffectiveGstHstForItc(
  e: Pick<ExpenseTaxFields, "gst_amount" | "hst_amount" | "tax_amount">,
): { gst: number; hst: number } {
  const gstRaw = e.gst_amount ?? 0;
  const hstRaw = e.hst_amount ?? 0;
  const taxAmt = e.tax_amount ?? 0;
  if (gstRaw <= EPS && hstRaw <= EPS && taxAmt > EPS) {
    return { gst: 0, hst: taxAmt };
  }
  return { gst: gstRaw, hst: hstRaw };
}

/** Total recoverable ITC (GST + HST) using stored values or BC category estimate when allowed. */
export function getEffectiveRecoverableItcCad(e: ExpenseItcMeta): number {
  if (e.gst_itc_estimated === true) {
    if (shouldBypassCanadianItcEstimation(e.original_currency || e.currency, e.jurisdiction)) {
      return 0;
    }
    const gst = e.gst_amount ?? 0;
    const hst = e.hst_amount ?? 0;
    return roundMoney(gst + hst);
  }
  if (e.gst_itc_estimated === false) {
    const { gst, hst } = getEffectiveGstHstForItc(e);
    return roundMoney(gst + hst);
  }
  if (expenseHasManualOrParsedTax(e)) {
    const { gst, hst } = getEffectiveGstHstForItc(e);
    return roundMoney(gst + hst);
  }
  const gross = e.cad_amount ?? 0;
  if (shouldBypassCanadianItcEstimation(e.original_currency || e.currency, e.jurisdiction)) {
    return 0;
  }
  if (!isCanadaJurisdiction(e.jurisdiction) || gross <= 0) {
    return 0;
  }
  return estimateBcRecoverableItcCad(e.category || "uncategorized", gross);
}

/** Net operating expense for P&L display: gross CAD − recoverable ITC (PST stays in gross). */
export function getNetExpenseCad(e: ExpenseItcMeta): number {
  const gross = e.cad_amount ?? 0;
  const itc = getEffectiveRecoverableItcCad(e);
  return roundMoney(Math.max(0, gross - itc));
}

/** Export / audit: whether ITC came from category auto-estimate vs receipt or manual entry. */
export function getItcSourceLabel(e: ExpenseItcMeta): "Auto-Estimated" | "Manual / Receipt" {
  if (e.gst_itc_estimated === true) {
    if (shouldBypassCanadianItcEstimation(e.original_currency || e.currency, e.jurisdiction)) {
      return "Manual / Receipt";
    }
    return "Auto-Estimated";
  }
  if (e.gst_itc_estimated === false) return "Manual / Receipt";
  if (expenseHasManualOrParsedTax(e)) return "Manual / Receipt";
  if (shouldBypassCanadianItcEstimation(e.original_currency || e.currency, e.jurisdiction)) {
    return "Manual / Receipt";
  }
  if (!isCanadaJurisdiction(e.jurisdiction)) return "Manual / Receipt";
  const gross = e.cad_amount ?? 0;
  if (gross <= EPS) return "Manual / Receipt";
  return "Auto-Estimated";
}
