"""Export functionality for accountants - Final Implementation."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List
from datetime import datetime
from uuid import UUID
import io
import csv
import pandas as pd

from database import get_db
from models import User, Expense, ExpenseCategory
from routers.auth import get_current_user
from bc_expense_tax import effective_recoverable_itc_cad, itc_source_label, net_expense_cad
from expense_operating import (
    operating_expenses_for_export,
    operating_expenses_excluding_assets_only,
    is_excluded_from_business_pl,
)

router = APIRouter()

# CRA Tax Deduction Rates by Category
# These rates determine what percentage of the expense can be deducted from taxable income
# CRA T2125 Deduction Rates
DEDUCTION_RATES = {
    ExpenseCategory.FUEL: 1.0,                    # 100% deductible
    ExpenseCategory.MAINTENANCE_REPAIRS: 1.0,    # 100% deductible
    ExpenseCategory.INSURANCE: 1.0,              # 100% deductible (truck, cargo, liability)
    ExpenseCategory.LICENSES_DUES: 1.0,          # 100% deductible
    ExpenseCategory.TOLLS_SCALES: 1.0,           # 100% deductible
    ExpenseCategory.MEALS_ENTERTAINMENT: 0.5,    # 50% deductible (CRA standard rule)
    ExpenseCategory.TRAVEL_LODGING: 1.0,         # 100% deductible
    ExpenseCategory.OFFICE_ADMIN: 1.0,           # 100% deductible
    ExpenseCategory.FACTORING_FEES: 1.0,         # 100% deductible (financing cost)
    ExpenseCategory.PAYROLL: 1.0,                # 100% deductible (wages)
    ExpenseCategory.SUBCONTRACTOR: 1.0,          # 100% deductible
    ExpenseCategory.PROFESSIONAL_FEES: 1.0,      # 100% deductible
    ExpenseCategory.RENT_LEASE: 1.0,             # 100% deductible
    ExpenseCategory.LOAN_INTEREST: 1.0,          # 100% deductible (interest only)
    ExpenseCategory.PERSONAL: 0.0,               # Not a business deduction
    ExpenseCategory.OTHER_EXPENSES: 1.0,         # 100% deductible
    ExpenseCategory.UNCATEGORIZED: 0.0,          # 0% - Safety default until categorized
}


def calculate_deductible_amount(expense: Expense) -> float:
    """Calculate the deductible amount for an expense based on CRA rules."""
    cad_amount = expense.cad_amount or 0
    deduction_rate = DEDUCTION_RATES.get(expense.category, 0.0)
    return round(cad_amount * deduction_rate, 2)


@router.get("/csv")
async def export_csv(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    verified_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Export operating expenses to CSV (excludes Assets/CCA reclasses and Personel category).

    Includes ALL required fields per the Final Implementation Brief:
    - Date | Vendor | Category
    - Original Currency | Original Amount
    - Exchange Rate (Bank of Canada)
    - CAD Equivalent Amount (PRIMARY ACCOUNTING VALUE)
    - GST/HST (ITC eligible for Canadian receipts)
    - Payment Source (Company Card / Due to Shareholder)
    - Image Link (GCS signed URL)
    """
    # Build query
    query = select(Expense).where(Expense.user_id == current_user.id)
    
    if start_date:
        query = query.where(Expense.transaction_date >= start_date)
    
    if end_date:
        query = query.where(Expense.transaction_date <= end_date)
    
    if categories:
        cat_list = [c.strip() for c in categories.split(",")]
        cat_enums = []
        for cat in cat_list:
            try:
                cat_enums.append(ExpenseCategory(cat))
            except ValueError:
                pass
        if cat_enums:
            query = query.where(Expense.category.in_(cat_enums))
    
    if verified_only:
        query = query.where(Expense.is_verified == True)
    
    query = query.order_by(Expense.transaction_date.desc())
    
    result = await db.execute(query)
    expenses = operating_expenses_for_export(list(result.scalars().all()))
    
    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header row - All fields required by accountant with separate tax columns
    writer.writerow([
        "Date",
        "Vendor",
        "Category",
        "Original Currency",
        "Original Amount",
        "Exchange Rate (BOC)",
        "CAD Equivalent Amount",  # Gross (bank / receipt)
        "Net Expense (CAD)",      # Gross − Tax Recoverable (ITC); PST remains
        "GST (5%)",               # Recorded federal component
        "HST (13-15%)",           # Recorded harmonized component
        "PST (6-10%)",            # Provincial — not recoverable
        "Total Tax",              # Sum of recorded GST + HST + PST
        "Tax Recoverable (ITC)",  # Effective ITC (dashboard logic)
        "ITC Source",             # Auto-Estimated | Manual / Receipt
        "Payment Source",
        "Due to Shareholder",
        "Jurisdiction",
        "Receipt Image Link",
        "Notes"
    ])
    
    # Data rows
    for expense in expenses:
        # Payment source determination
        payment_source = expense.payment_source.value.replace("_", " ").title()
        due_to_shareholder = "Yes" if expense.payment_source.value == "personal_card" else "No"
        
        # Category display
        category_display = expense.category.value.replace("_", " ").title()
        
        # Jurisdiction display
        jurisdiction_display = expense.jurisdiction.value.upper() if expense.jurisdiction else "UNKNOWN"
        
        # Notes with 50% rule reminder for meals
        notes = expense.notes or ""
        if expense.category == ExpenseCategory.MEALS_ENTERTAINMENT:
            notes = f"50% deductible for CRA. {notes}".strip()
        
        # Exchange rate display
        exchange_rate = f"{expense.exchange_rate:.4f}" if expense.exchange_rate and expense.exchange_rate != 1.0 else "N/A (CAD)"
        
        gst = expense.gst_amount or 0
        hst = expense.hst_amount or 0
        pst = expense.pst_amount or 0
        tax_amt = expense.tax_amount or 0
        effective_hst = hst
        if gst <= 1e-6 and hst <= 1e-6 and tax_amt > 1e-6:
            effective_hst = tax_amt
        total_tax = gst + effective_hst + pst
        net_cad = net_expense_cad(expense)
        itc_eff = effective_recoverable_itc_cad(expense)
        itc_src = itc_source_label(expense)

        writer.writerow([
            expense.transaction_date.strftime("%Y-%m-%d") if expense.transaction_date else "",
            expense.vendor_name or "",
            category_display,
            expense.original_currency,
            f"{expense.original_amount:.2f}" if expense.original_amount else "",
            exchange_rate,
            f"{expense.cad_amount:.2f}" if expense.cad_amount else "",
            f"{net_cad:.2f}",
            f"{gst:.2f}",
            f"{effective_hst:.2f}",
            f"{pst:.2f}",
            f"{total_tax:.2f}",
            f"{itc_eff:.2f}",
            itc_src,
            payment_source,
            due_to_shareholder,
            jurisdiction_display,
            expense.receipt_image_url or "",
            notes
        ])
    
    # Prepare response
    output.seek(0)
    
    filename = f"quickyel_expenses_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/xlsx")
async def export_xlsx(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    verified_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Export expenses to Excel format with professional formatting.
    
    Includes:
    - Main expenses sheet with all columns
    - Summary by Category sheet
    - Totals row with CAD amounts summed
    """
    # Build query (same as CSV)
    query = select(Expense).where(Expense.user_id == current_user.id)
    
    if start_date:
        query = query.where(Expense.transaction_date >= start_date)
    
    if end_date:
        query = query.where(Expense.transaction_date <= end_date)
    
    if categories:
        cat_list = [c.strip() for c in categories.split(",")]
        cat_enums = []
        for cat in cat_list:
            try:
                cat_enums.append(ExpenseCategory(cat))
            except ValueError:
                pass
        if cat_enums:
            query = query.where(Expense.category.in_(cat_enums))
    
    if verified_only:
        query = query.where(Expense.is_verified == True)
    
    query = query.order_by(Expense.transaction_date.desc())
    
    result = await db.execute(query)
    expenses = operating_expenses_for_export(list(result.scalars().all()))
    
    # Prepare data for DataFrame
    data = []
    for expense in expenses:
        payment_source = expense.payment_source.value.replace("_", " ").title()
        due_to_shareholder = "Yes" if expense.payment_source.value == "personal_card" else "No"
        category_display = expense.category.value.replace("_", " ").title()
        jurisdiction_display = expense.jurisdiction.value.upper() if expense.jurisdiction else "UNKNOWN"
        
        notes = expense.notes or ""
        if expense.category == ExpenseCategory.MEALS_ENTERTAINMENT:
            notes = f"50% deductible. {notes}".strip()
        
        gst = expense.gst_amount or 0
        hst = expense.hst_amount or 0
        pst = expense.pst_amount or 0
        tax_amt = expense.tax_amount or 0
        effective_hst = hst
        if gst <= 1e-6 and hst <= 1e-6 and tax_amt > 1e-6:
            effective_hst = tax_amt
        total_tax = gst + effective_hst + pst
        net_c = net_expense_cad(expense)
        itc_e = effective_recoverable_itc_cad(expense)
        itc_s = itc_source_label(expense)

        data.append({
            "Date": expense.transaction_date.strftime("%Y-%m-%d") if expense.transaction_date else "",
            "Vendor": expense.vendor_name or "",
            "Category": category_display,
            "Original Currency": expense.original_currency,
            "Original Amount": expense.original_amount or 0,
            "Exchange Rate (BOC)": expense.exchange_rate if expense.exchange_rate != 1.0 else None,
            "CAD Equivalent Amount": expense.cad_amount or 0,
            "Net Expense (CAD)": net_c,
            "GST (5%)": gst,
            "HST (13-15%)": effective_hst,
            "PST (6-10%)": pst,
            "Total Tax": total_tax,
            "Tax Recoverable (ITC)": itc_e,
            "ITC Source": itc_s,
            "Payment Source": payment_source,
            "Due to Shareholder": due_to_shareholder,
            "Jurisdiction": jurisdiction_display,
            "Receipt Image Link": expense.receipt_image_url or "",
            "Notes": notes
        })
    
    # Create DataFrames
    df = pd.DataFrame(data)
    
    # Create summary by category with separate tax columns
    if not df.empty:
        summary = df.groupby("Category").agg({
            "CAD Equivalent Amount": ["count", "sum"],
            "Net Expense (CAD)": "sum",
            "Tax Recoverable (ITC)": "sum",
            "GST (5%)": "sum",
            "HST (13-15%)": "sum",
            "PST (6-10%)": "sum",
            "Total Tax": "sum"
        }).reset_index()
        summary.columns = [
            "Category", "Receipt Count", "Total CAD Gross", "Total Net CAD",
            "Total ITC", "Total GST", "Total HST", "Total PST", "Total Tax"
        ]
        
        # Calculate 50% for meals
        meals_row = summary[summary["Category"] == "Meals Entertainment"]
        if not meals_row.empty:
            meals_deductible = meals_row["Total CAD Gross"].values[0] * 0.5
        else:
            meals_deductible = 0
    else:
        summary = pd.DataFrame(columns=[
            "Category", "Receipt Count", "Total CAD Gross", "Total Net CAD",
            "Total ITC", "Total GST", "Total HST", "Total PST", "Total Tax"
        ])
        meals_deductible = 0
    
    # Due to Shareholder summary
    if not df.empty:
        shareholder_summary = df[df["Due to Shareholder"] == "Yes"]["Net Expense (CAD)"].sum()
        company_summary = df[df["Due to Shareholder"] == "No"]["Net Expense (CAD)"].sum()
    else:
        shareholder_summary = 0
        company_summary = 0
    
    # Write to Excel
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        # Main expenses sheet
        if not df.empty:
            df.to_excel(writer, sheet_name='Expenses', index=False)
        else:
            pd.DataFrame({"Message": ["No verified expenses found"]}).to_excel(
                writer, sheet_name='Expenses', index=False
            )
        
        # Summary by category sheet
        summary.to_excel(writer, sheet_name='Summary by Category', index=False)
        
        # Key figures sheet with separate tax totals
        key_figures = pd.DataFrame({
            "Metric": [
                "Total Expenses (CAD) — net of recoverable GST/HST (ITC)",
                "Gross Operating Expenses (CAD) — before ITC",
                "Total GST+HST Recoverable (ITC) — asset",
                "PST (6-10%) — not recoverable (sunk; in net expense)",
                "Recorded GST (5%) — line items",
                "Recorded HST (13-15%) — line items",
                "Recorded taxes sum (GST+HST+PST)",
                "Meals (50% Deductible)",
                "Company Card (net CAD)",
                "Due to Shareholder (net CAD)",
                "Total Receipts"
            ],
            "Value": [
                df["Net Expense (CAD)"].sum() if not df.empty else 0,
                df["CAD Equivalent Amount"].sum() if not df.empty else 0,
                df["Tax Recoverable (ITC)"].sum() if not df.empty else 0,
                df["PST (6-10%)"].sum() if not df.empty else 0,
                df["GST (5%)"].sum() if not df.empty else 0,
                df["HST (13-15%)"].sum() if not df.empty else 0,
                df["Total Tax"].sum() if not df.empty else 0,
                meals_deductible,
                company_summary,
                shareholder_summary,
                len(df)
            ]
        })
        key_figures.to_excel(writer, sheet_name='Key Figures', index=False)
        
        # Add totals row to main sheet (column indices follow DataFrame column order)
        if not df.empty:
            ws = writer.sheets['Expenses']
            last_row = len(df) + 2
            ws.cell(row=last_row, column=1, value="TOTALS")
            for col_idx, col_name in enumerate(df.columns, start=1):
                if col_name in (
                    "Original Amount",
                    "CAD Equivalent Amount",
                    "Net Expense (CAD)",
                    "GST (5%)",
                    "HST (13-15%)",
                    "PST (6-10%)",
                    "Total Tax",
                    "Tax Recoverable (ITC)",
                ):
                    ws.cell(row=last_row, column=col_idx, value=df[col_name].sum())
    
    output.seek(0)
    
    filename = f"quickyel_expenses_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/summary")
async def get_summary(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get expense summary statistics for dashboard display.
    
    Returns totals by category and payment source.
    """
    query = select(Expense).where(
        Expense.user_id == current_user.id,
        Expense.is_verified == True
    )
    
    if start_date:
        query = query.where(Expense.transaction_date >= start_date)
    
    if end_date:
        query = query.where(Expense.transaction_date <= end_date)
    
    result = await db.execute(query)
    operating = operating_expenses_excluding_assets_only(list(result.scalars().all()))
    pl_for_totals = [e for e in operating if not is_excluded_from_business_pl(e)]

    # Calculate summaries with separate tax totals (Personel excluded from P&L totals)
    total_cad = sum(e.cad_amount or 0 for e in pl_for_totals)
    total_gst = sum(e.gst_amount or 0 for e in pl_for_totals)  # GST only (5%)
    total_hst = sum(e.hst_amount or 0 for e in pl_for_totals)  # HST only (13-15%)
    total_pst = sum(e.pst_amount or 0 for e in pl_for_totals)  # PST (not recoverable)
    total_tax = total_gst + total_hst + total_pst         # Total all taxes
    total_itc_recoverable = total_gst + total_hst         # Only GST + HST are ITC recoverable

    # Calculate total potential tax deductions (T2125 form)
    total_potential_deductions = sum(calculate_deductible_amount(e) for e in pl_for_totals)

    # By category (includes Personel for display; totals above exclude it)
    by_category = {}
    for expense in operating:
        cat = expense.category.value
        if cat not in by_category:
            by_category[cat] = {
                "count": 0,
                "total_cad": 0,
                "total_gst": 0,
                "total_hst": 0,
                "total_pst": 0,
                "total_tax": 0,
                "total_deductible": 0,
                "deduction_rate": DEDUCTION_RATES.get(expense.category, 0.0)
            }
        by_category[cat]["count"] += 1
        by_category[cat]["total_cad"] += expense.cad_amount or 0
        by_category[cat]["total_gst"] += expense.gst_amount or 0
        by_category[cat]["total_hst"] += expense.hst_amount or 0
        by_category[cat]["total_pst"] += expense.pst_amount or 0
        by_category[cat]["total_tax"] += (expense.gst_amount or 0) + (expense.hst_amount or 0) + (expense.pst_amount or 0)
        by_category[cat]["total_deductible"] += calculate_deductible_amount(expense)
    
    # By payment source
    by_source = {
        "company_card": 0,
        "personal_card": 0,
        "bank_checking": 0,
        "e_transfer": 0,
        "unknown": 0
    }
    for expense in pl_for_totals:
        source = expense.payment_source.value
        if source not in by_source:
            by_source["unknown"] += expense.cad_amount or 0
        else:
            by_source[source] += expense.cad_amount or 0
    
    # Calculate 50% deductible for meals (CRA rule)
    meals_total = by_category.get("meals_entertainment", {}).get("total_cad", 0)
    meals_deductible = meals_total * 0.5
    
    return {
        "period": {
            "start": start_date.isoformat() if start_date else None,
            "end": end_date.isoformat() if end_date else None
        },
        "totals": {
            "expense_count": len(pl_for_totals),
            "total_cad": round(total_cad, 2),
            # Separate tax totals
            "total_gst": round(total_gst, 2),               # GST only (5%)
            "total_hst": round(total_hst, 2),               # HST only (13-15%)
            "total_pst": round(total_pst, 2),               # PST only (not recoverable)
            "total_tax": round(total_tax, 2),               # Sum of all taxes
            "total_tax_recoverable": round(total_itc_recoverable, 2),  # GST + HST (ITC recoverable)
            "total_potential_deductions": round(total_potential_deductions, 2),  # T2125 tax deductions
            "meals_50_percent": round(meals_deductible, 2)
        },
        "by_category": by_category,
        "by_payment_source": {
            "company_expenses": round(by_source["company_card"], 2),
            "due_to_shareholder": round(by_source["personal_card"], 2),
            "bank_checking": round(by_source.get("bank_checking", 0), 2),
            "e_transfer": round(by_source.get("e_transfer", 0), 2),
            "unknown": round(by_source["unknown"], 2)
        }
    }
