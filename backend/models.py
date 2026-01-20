"""SQLAlchemy database models - SQLite compatible."""

from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from database import Base


def generate_uuid():
    return str(uuid.uuid4())


class ExpenseCategory(enum.Enum):
    """CRA T2125 compliant expense categories."""
    FUEL = "fuel"
    MAINTENANCE_REPAIRS = "maintenance_repairs"
    INSURANCE = "insurance"  # NEW: Truck insurance, cargo, liability
    LICENSES_DUES = "licenses_dues"
    TOLLS_SCALES = "tolls_scales"
    MEALS_ENTERTAINMENT = "meals_entertainment"
    TRAVEL_LODGING = "travel_lodging"
    OFFICE_ADMIN = "office_admin"
    OTHER_EXPENSES = "other_expenses"  # NEW: Catch-all for business expenses
    UNCATEGORIZED = "uncategorized"


class PaymentSource(enum.Enum):
    """Payment source classification."""
    COMPANY_CARD = "company_card"
    PERSONAL_CARD = "personal_card"  # Due to Shareholder
    UNKNOWN = "unknown"


class Jurisdiction(enum.Enum):
    """Transaction jurisdiction."""
    CANADA = "canada"
    USA = "usa"
    UNKNOWN = "unknown"


class User(Base):
    """User model for authentication."""
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), default="driver")  # driver, admin, accountant
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    expenses = relationship("Expense", back_populates="user")
    cards = relationship("Card", back_populates="user")


class Card(Base):
    """Payment card model for expense tracking."""
    __tablename__ = "cards"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    last_four = Column(String(4), nullable=False)
    card_name = Column(String(100), nullable=False)  # e.g., "Company Visa", "Personal Amex"
    is_company_card = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="cards")


class Expense(Base):
    """Expense/Receipt model."""
    __tablename__ = "expenses"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    
    # Vendor & Transaction
    vendor_name = Column(String(255), nullable=True)
    transaction_date = Column(DateTime, nullable=True)
    
    # Categorization
    category = Column(SQLEnum(ExpenseCategory), default=ExpenseCategory.UNCATEGORIZED)
    jurisdiction = Column(SQLEnum(Jurisdiction), default=Jurisdiction.UNKNOWN)
    
    # Amounts (Original Currency)
    original_amount = Column(Float, nullable=True)
    original_currency = Column(String(3), default="CAD")  # CAD or USD
    
    # Tax Amounts - Stored Separately for Reporting
    # GST (5%) - Federal tax, ITC recoverable (used in AB, BC, MB, NT, NU, SK, YT)
    gst_amount = Column(Float, default=0.0)
    # HST (13-15%) - Harmonized tax, ITC recoverable (used in ON, NB, NL, NS, PE)
    hst_amount = Column(Float, default=0.0)
    # PST (6-10%) - Provincial tax, NOT recoverable (used in BC, MB, SK, QC as QST)
    pst_amount = Column(Float, default=0.0)
    # Total Tax - Computed sum of GST + HST + PST for convenience
    tax_amount = Column(Float, default=0.0)
    
    # Currency Conversion
    exchange_rate = Column(Float, default=1.0)
    cad_amount = Column(Float, nullable=True)
    
    # Payment
    card_last_4 = Column(String(4), nullable=True)
    payment_source = Column(SQLEnum(PaymentSource), default=PaymentSource.UNKNOWN)
    
    # Receipt Data
    receipt_image_url = Column(Text, nullable=True)
    raw_ocr_text = Column(Text, nullable=True)
    
    # Processing Status
    is_verified = Column(Boolean, default=False)
    processing_status = Column(String(50), default="pending")  # pending, processing, completed, error
    error_message = Column(Text, nullable=True)
    
    # Metadata
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="expenses")


class ExchangeRateCache(Base):
    """Cache for Bank of Canada exchange rates."""
    __tablename__ = "exchange_rate_cache"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    date = Column(DateTime, nullable=False, unique=True, index=True)
    usd_to_cad = Column(Float, nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow)
