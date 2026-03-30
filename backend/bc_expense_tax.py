"""BC net-of-GST / ITC helpers — mirrors frontend bc-expense-tax.ts for SQL exports."""

from __future__ import annotations

from models import Expense, Jurisdiction

EPS = 1e-6

GST_ONLY_5 = frozenset({"subcontractor", "professional_fees", "fuel"})
GST_FROM_12 = frozenset({"maintenance_repairs", "office_admin", "rent_lease"})
ITC_ZERO = frozenset({
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
    "meals_entertainment",
})


def _round_money(n: float) -> float:
    return round(n, 2)


def estimate_bc_recoverable_itc_cad(category: str, gross_cad: float) -> float:
    if not gross_cad or gross_cad <= 0:
        return 0.0
    cat = (category or "uncategorized").lower()
    if cat == "meals_entertainment":
        full_gst = gross_cad - gross_cad / 1.05
        return _round_money(full_gst * 0.5)
    if cat in GST_ONLY_5:
        return _round_money(gross_cad - gross_cad / 1.05)
    if cat in GST_FROM_12:
        return _round_money((gross_cad / 1.12) * 0.05)
    if cat in ITC_ZERO:
        return 0.0
    return 0.0


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
    flag = getattr(e, "gst_itc_estimated", None)
    if flag is True:
        return _round_money((e.gst_amount or 0) + (e.hst_amount or 0))
    if flag is False:
        g, h = get_effective_gst_hst_for_itc(e)
        return _round_money(g + h)
    if expense_has_manual_or_parsed_tax(e):
        g, h = get_effective_gst_hst_for_itc(e)
        return _round_money(g + h)
    gross = e.cad_amount or 0
    cur = (e.original_currency or "CAD").upper()
    if cur == "USD" or e.jurisdiction != Jurisdiction.CANADA or gross <= 0:
        return 0.0
    cat = e.category.value if e.category else "uncategorized"
    return estimate_bc_recoverable_itc_cad(cat, gross)


def net_expense_cad(e: Expense) -> float:
    gross = e.cad_amount or 0
    itc = effective_recoverable_itc_cad(e)
    return _round_money(max(0.0, gross - itc))


def itc_source_label(e: Expense) -> str:
    flag = getattr(e, "gst_itc_estimated", None)
    if flag is True:
        return "Auto-Estimated"
    if flag is False:
        return "Manual / Receipt"
    if expense_has_manual_or_parsed_tax(e):
        return "Manual / Receipt"
    cur = (e.original_currency or "CAD").upper()
    if cur == "USD" or e.jurisdiction != Jurisdiction.CANADA:
        return "Manual / Receipt"
    if (e.cad_amount or 0) <= EPS:
        return "Manual / Receipt"
    return "Auto-Estimated"
