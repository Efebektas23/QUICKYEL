"""Pydantic schemas for request/response validation."""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from enum import Enum


# Enums - CRA T2125 Compliant Categories
class ExpenseCategory(str, Enum):
    FUEL = "fuel"
    MAINTENANCE_REPAIRS = "maintenance_repairs"
    INSURANCE = "insurance"  # Truck insurance, cargo, liability
    LICENSES_DUES = "licenses_dues"
    TOLLS_SCALES = "tolls_scales"
    MEALS_ENTERTAINMENT = "meals_entertainment"
    TRAVEL_LODGING = "travel_lodging"
    OFFICE_ADMIN = "office_admin"
    OTHER_EXPENSES = "other_expenses"  # Catch-all for business expenses
    UNCATEGORIZED = "uncategorized"


class PaymentSource(str, Enum):
    COMPANY_CARD = "company_card"
    PERSONAL_CARD = "personal_card"
    UNKNOWN = "unknown"


class Jurisdiction(str, Enum):
    CANADA = "canada"
    USA = "usa"
    UNKNOWN = "unknown"


# Auth Schemas
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=2)
    role: str = "driver"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# Card Schemas
class CardCreate(BaseModel):
    last_four: str = Field(..., min_length=4, max_length=4)
    card_name: str = Field(..., min_length=2)
    is_company_card: bool = False


class CardResponse(BaseModel):
    id: UUID
    last_four: str
    card_name: str
    is_company_card: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Expense Schemas
class ExpenseCreate(BaseModel):
    """Manual expense creation."""
    vendor_name: Optional[str] = None
    transaction_date: Optional[datetime] = None
    category: ExpenseCategory = ExpenseCategory.UNCATEGORIZED
    original_amount: Optional[float] = None
    original_currency: str = "CAD"
    # Tax amounts - enter separately for accurate reporting
    gst_amount: float = 0.0  # GST only (5%)
    hst_amount: float = 0.0  # HST only (13-15%)
    pst_amount: float = 0.0  # PST only (6-10%)
    notes: Optional[str] = None


class ExpenseUpdate(BaseModel):
    """Update expense after review."""
    vendor_name: Optional[str] = None
    transaction_date: Optional[datetime] = None
    category: Optional[ExpenseCategory] = None
    original_amount: Optional[float] = None
    # Tax amounts - update separately for accurate reporting
    gst_amount: Optional[float] = None  # GST only (5%)
    hst_amount: Optional[float] = None  # HST only (13-15%)
    pst_amount: Optional[float] = None  # PST only (6-10%)
    is_verified: bool = False
    notes: Optional[str] = None


class ExpenseResponse(BaseModel):
    id: UUID
    user_id: UUID
    vendor_name: Optional[str]
    transaction_date: Optional[datetime]
    category: ExpenseCategory
    jurisdiction: Jurisdiction
    original_amount: Optional[float]
    original_currency: str
    # Tax amounts - stored separately for reporting
    gst_amount: float = 0.0  # GST only (5%)
    hst_amount: float = 0.0  # HST only (13-15%)
    pst_amount: float = 0.0  # PST only (6-10%)
    tax_amount: float = 0.0  # Total tax (sum of GST + HST + PST)
    exchange_rate: float
    cad_amount: Optional[float]
    card_last_4: Optional[str]
    payment_source: PaymentSource
    receipt_image_url: Optional[str]
    is_verified: bool
    processing_status: str
    error_message: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ExpenseListResponse(BaseModel):
    expenses: List[ExpenseResponse]
    total: int
    page: int
    per_page: int


# AI Parsing Response
class ParsedReceiptData(BaseModel):
    """Data extracted by GPT from OCR text."""
    vendor_name: Optional[str] = None
    transaction_date: Optional[str] = None  # YYYY-MM-DD format
    jurisdiction: str = "unknown"  # "usa" or "canada"
    province: Optional[str] = None  # Province code for tax determination (ON, BC, AB, etc.)
    category: str = "uncategorized"
    total_amount: Optional[float] = None
    # Tax amounts - extracted separately for accurate reporting
    gst_amount: float = 0.0  # GST only (5%) - Federal tax, ITC recoverable
    hst_amount: float = 0.0  # HST only (13-15%) - Harmonized tax, ITC recoverable
    pst_amount: float = 0.0  # PST only (6-10%) - Provincial tax, NOT recoverable
    tax_amount: float = 0.0  # Total tax (computed sum)
    card_last_4: Optional[str] = None
    confidence: float = 0.0


# Export Schemas
class ExportRequest(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    categories: Optional[List[ExpenseCategory]] = None
    format: str = "csv"  # csv or xlsx

