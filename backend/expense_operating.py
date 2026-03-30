"""Operating vs capitalized expense classification (aligned with Firebase client)."""

from typing import List

from models import Expense, ExpenseCategory

RECLASSIFIED_TO_ASSET_MARKER = "[RECLASSIFIED TO ASSET]"


def is_expense_reclassified_to_asset(expense: Expense) -> bool:
    """
    True when the row was moved to Assets / CCA and must be excluded from
    standard operating Expenses.csv / P&L aggregates.
    """
    if getattr(expense, "reclassified_to_asset", None) is True:
        return True
    notes = expense.notes or ""
    return RECLASSIFIED_TO_ASSET_MARKER in notes


def is_excluded_from_business_pl(expense: Expense) -> bool:
    """Personel — not part of operating P&L or accountant exports."""
    return expense.category == ExpenseCategory.PERSONAL


def operating_expenses_for_export(expenses: List[Expense]) -> List[Expense]:
    return [
        e
        for e in expenses
        if not is_expense_reclassified_to_asset(e) and not is_excluded_from_business_pl(e)
    ]


def operating_expenses_excluding_assets_only(expenses: List[Expense]) -> List[Expense]:
    """Operating rows only (still includes Personel for category breakdown)."""
    return [e for e in expenses if not is_expense_reclassified_to_asset(e)]
