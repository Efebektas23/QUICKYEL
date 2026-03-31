"""BC net-of-GST / ITC helpers — mirrors frontend bc-expense-tax.ts for SQL exports."""

from __future__ import annotations

from models import Expense, Jurisdiction

EPS = 1e-6


def _round_money(n: float) -> float:
    return round(n, 2)


def should_bypass_canadian_itc_estimation(e: Expense) -> bool:
    """USD-native or USA jurisdiction: never infer Canadian GST/HST ITC."""
    cur = (e.original_currency or "CAD").upper()
    if cur == "USD":
        return True
    if e.jurisdiction == Jurisdiction.USA:
        return True
    return False


def is_usd_payment(e: Expense) -> bool:
    """Original currency USD — no Canadian GST/HST/PST in ITC, net expense, or export tax columns."""
    return (e.original_currency or "CAD").upper() == "USD"


def apply_usd_payment_tax_policy(expense: Expense) -> None:
    """Mutate expense: USD payments cannot store Canadian tax (all categories)."""
    if not is_usd_payment(expense):
        return
    expense.gst_amount = 0.0
    expense.hst_amount = 0.0
    expense.pst_amount = 0.0
    expense.tax_amount = 0.0
    expense.gst_itc_estimated = False


def expense_has_manual_or_parsed_tax(e: Expense) -> bool:
    gst = e.gst_amount or 0
    hst = e.hst_amount or 0
    pst = e.pst_amount or 0
    tax = e.tax_amount or 0
    return gst > EPS or hst > EPS or pst > EPS or tax > EPS


def get_effective_gst_hst_for_itc(e: Expense) -> tuple[float, float]:
    gst_raw = e.gst_amount or 0
    hst_raw = e.hst_amount or 0
    tax_amt = e.tax_amount or 0
    if gst_raw <= EPS and hst_raw <= EPS and tax_amt > EPS:
        return 0.0, tax_amt
    return gst_raw, hst_raw


def effective_recoverable_itc_cad(e: Expense) -> float:
    if is_usd_payment(e):
        return 0.0
    if getattr(e, "gst_itc_estimated", None) is True:
        return 0.0
    if not expense_has_manual_or_parsed_tax(e):
        return 0.0
    g, h = get_effective_gst_hst_for_itc(e)
    return _round_money(g + h)


def net_expense_cad(e: Expense) -> float:
    gross = e.cad_amount or 0
    itc = effective_recoverable_itc_cad(e)
    return _round_money(max(0.0, gross - itc))


def recorded_canadian_tax_parts(e: Expense) -> tuple[float, float, float]:
    """GST, effective HST (with legacy tax_amount), PST. USD / legacy system estimate → zero."""
    if is_usd_payment(e):
        return 0.0, 0.0, 0.0
    if getattr(e, "gst_itc_estimated", None) is True:
        return 0.0, 0.0, 0.0
    gst = e.gst_amount or 0
    hst_raw = e.hst_amount or 0
    tax_amt = e.tax_amount or 0
    if gst <= EPS and hst_raw <= EPS and tax_amt > EPS:
        return gst, tax_amt, e.pst_amount or 0
    return gst, hst_raw, e.pst_amount or 0


def itc_source_label(_e: Expense) -> str:
    return "Manual / Receipt"
