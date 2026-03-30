"""Operating vs capitalized expense classification (aligned with Firebase client)."""

from typing import List

from models import Expense

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


def operating_expenses_for_export(expenses: List[Expense]) -> List[Expense]:
    return [e for e in expenses if not is_expense_reclassified_to_asset(e)]
