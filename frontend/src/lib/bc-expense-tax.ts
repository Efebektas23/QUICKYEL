/**
 * Canadian ITC: only from receipt/OCR or manually entered GST/HST (and legacy tax_amount → HST).
 * No category- or gross-based estimation.
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

/** True when the expense was paid in USD — no Canadian GST/HST/PST in calculations or exports. */
export function expenseIsUsdPayment(
  e: Pick<ExpenseTaxFields, "original_currency" | "currency">,
): boolean {
  return (e.original_currency || e.currency || "CAD").toUpperCase() === "USD";
}

/** GST/HST/PST as stored for UI and summaries — USD rows are always zero. */
export function storedCanadianTaxForDisplay(
  e: ExpenseItcMeta,
): { gst: number; hst: number; pst: number } {
  if (expenseIsUsdPayment(e)) return { gst: 0, hst: 0, pst: 0 };
  if (e.gst_itc_estimated === true) return { gst: 0, hst: 0, pst: 0 };
  const gst = e.gst_amount ?? 0;
  const hstRaw = e.hst_amount ?? 0;
  const taxAmt = e.tax_amount ?? 0;
  const hst = gst <= EPS && hstRaw <= EPS && taxAmt > EPS ? taxAmt : hstRaw;
  return { gst, hst, pst: e.pst_amount ?? 0 };
}

/** Persisted fields to clear for USD payments (all categories). */
export function usdPaymentZeroTaxWritePatch(): {
  gst_amount: number;
  hst_amount: number;
  pst_amount: number;
  tax_amount: number;
  gst_itc_estimated: false;
} {
  return {
    gst_amount: 0,
    hst_amount: 0,
    pst_amount: 0,
    tax_amount: 0,
    gst_itc_estimated: false,
  };
}

export type ExpenseItcMeta = ExpenseTaxFields & { gst_itc_estimated?: boolean };

const zeroTaxClearPatch = (): Record<string, unknown> => ({
  ...usdPaymentZeroTaxWritePatch(),
});

/**
 * Category bulk-edit: never apply ITC estimates. Strip legacy system-estimated tax; USD policy unchanged.
 */
export function mergeBcItcForCategoryChange(
  existing: ExpenseItcMeta,
  newCategory: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { category: newCategory };
  if (expenseIsUsdPayment(existing)) {
    Object.assign(out, usdPaymentZeroTaxWritePatch());
    return out;
  }
  const cur = existing.original_currency || existing.currency;
  if (shouldBypassCanadianItcEstimation(cur, existing.jurisdiction)) {
    if (existing.gst_itc_estimated === true) Object.assign(out, zeroTaxClearPatch());
    return out;
  }
  if (existing.gst_itc_estimated === true) {
    Object.assign(out, zeroTaxClearPatch());
    return out;
  }
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

/** Recoverable ITC (GST + HST) only from entered/parsed tax lines — never from category or gross. */
export function getEffectiveRecoverableItcCad(e: ExpenseItcMeta): number {
  if (expenseIsUsdPayment(e)) {
    return 0;
  }
  if (e.gst_itc_estimated === true) {
    return 0;
  }
  if (!expenseHasManualOrParsedTax(e)) {
    return 0;
  }
  const { gst, hst } = getEffectiveGstHstForItc(e);
  return roundMoney(gst + hst);
}

/** Net operating expense for P&L display: gross CAD − recoverable ITC (PST stays in gross). */
export function getNetExpenseCad(e: ExpenseItcMeta): number {
  const gross = e.cad_amount ?? 0;
  const itc = getEffectiveRecoverableItcCad(e);
  return roundMoney(Math.max(0, gross - itc));
}

/** Export / audit label — category-based estimation is disabled. */
export function getItcSourceLabel(_e: ExpenseItcMeta): "Auto-Estimated" | "Manual / Receipt" {
  return "Manual / Receipt";
}
