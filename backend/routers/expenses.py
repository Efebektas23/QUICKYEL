"""Expenses/Receipts management router - Google Native Stack."""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from datetime import datetime
import logging

from database import get_db
from models import User, Expense, ExpenseCategory, Jurisdiction, PaymentSource
from schemas import (
    ExpenseCreate, ExpenseUpdate, ExpenseResponse, 
    ExpenseListResponse, ParsedReceiptData
)
from routers.auth import get_current_user
from routers.cards import match_card
from services.ocr_service import ocr_service
from services.gemini_service import gemini_service
from services.currency_service import currency_service
from services.storage_service import storage_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=ExpenseListResponse)
async def list_expenses(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    category: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    verified_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List expenses with pagination and filtering."""
    # Base query
    query = select(Expense).where(Expense.user_id == current_user.id)
    count_query = select(func.count(Expense.id)).where(Expense.user_id == current_user.id)
    
    # Apply filters
    if category:
        try:
            cat_enum = ExpenseCategory(category)
            query = query.where(Expense.category == cat_enum)
            count_query = count_query.where(Expense.category == cat_enum)
        except ValueError:
            pass
    
    if start_date:
        query = query.where(Expense.transaction_date >= start_date)
        count_query = count_query.where(Expense.transaction_date >= start_date)
    
    if end_date:
        query = query.where(Expense.transaction_date <= end_date)
        count_query = count_query.where(Expense.transaction_date <= end_date)
    
    if verified_only:
        query = query.where(Expense.is_verified == True)
        count_query = count_query.where(Expense.is_verified == True)
    
    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    # Paginate
    offset = (page - 1) * per_page
    query = query.order_by(Expense.transaction_date.desc()).offset(offset).limit(per_page)
    
    result = await db.execute(query)
    expenses = result.scalars().all()
    
    return ExpenseListResponse(
        expenses=[ExpenseResponse.model_validate(e) for e in expenses],
        total=total,
        page=page,
        per_page=per_page
    )


@router.get("/usage")
async def get_ocr_usage(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get OCR usage statistics for rate limit monitoring."""
    stats = await ocr_service.get_usage_stats(db)
    return stats


@router.post("/upload", response_model=ExpenseResponse)
async def upload_receipt(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload a receipt image and process it through the Google Native pipeline.
    
    Pipeline Steps:
    1. Upload image to Google Cloud Storage
    2. Extract text with Google Cloud Vision OCR
    3. Parse text with Google Gemini 1.5 Flash
    4. Convert currency if needed (Bank of Canada API)
    5. Match payment card
    6. Save to database (pending verification)
    """
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_types)}"
        )
    
    # Read file content
    content = await file.read()
    
    # Limit file size (10MB)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 10MB"
        )
    
    # Create initial expense record
    expense = Expense(
        user_id=current_user.id,
        processing_status="processing"
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    
    try:
        # Step 1: Upload to Google Cloud Storage
        file_ext = file.filename.split(".")[-1] if file.filename else "jpg"
        image_url = await storage_service.upload_receipt(
            content, 
            str(current_user.id),
            file_ext
        )
        expense.receipt_image_url = image_url
        
        # Step 2: OCR with Google Cloud Vision (with rate limiting)
        logger.info(f"Processing receipt for expense {expense.id}")
        ocr_text = await ocr_service.extract_text(content, db)
        
        if not ocr_text:
            expense.processing_status = "error"
            expense.error_message = "Could not extract text from image. Please ensure the receipt is clearly visible."
            await db.commit()
            return ExpenseResponse.model_validate(expense)
        
        expense.raw_ocr_text = ocr_text
        
        # Step 3: Parse with Google Gemini 1.5 Flash
        parsed_data = await gemini_service.parse_receipt(ocr_text)
        
        # Step 4: Apply parsed data
        expense.vendor_name = parsed_data.vendor_name
        expense.card_last_4 = parsed_data.card_last_4
        
        # Parse transaction date
        if parsed_data.transaction_date:
            try:
                expense.transaction_date = datetime.strptime(
                    parsed_data.transaction_date, "%Y-%m-%d"
                )
            except ValueError:
                expense.transaction_date = datetime.utcnow()
        else:
            expense.transaction_date = datetime.utcnow()
        
        # Set category
        try:
            expense.category = ExpenseCategory(parsed_data.category)
        except ValueError:
            expense.category = ExpenseCategory.UNCATEGORIZED
        
        # Set jurisdiction
        try:
            expense.jurisdiction = Jurisdiction(parsed_data.jurisdiction)
        except ValueError:
            expense.jurisdiction = Jurisdiction.UNKNOWN
        
        # Set amounts
        expense.original_amount = parsed_data.total_amount
        
        # Tax amounts - stored separately for accurate reporting
        if expense.jurisdiction == Jurisdiction.CANADA:
            expense.gst_amount = parsed_data.gst_amount
            expense.hst_amount = parsed_data.hst_amount
            expense.pst_amount = parsed_data.pst_amount
            expense.tax_amount = parsed_data.gst_amount + parsed_data.hst_amount + parsed_data.pst_amount
        else:
            # US receipts - no recoverable tax
            expense.gst_amount = 0.0
            expense.hst_amount = 0.0
            expense.pst_amount = 0.0
            expense.tax_amount = 0.0
        
        # Step 5: Currency conversion (Bank of Canada API)
        if expense.jurisdiction == Jurisdiction.USA and expense.original_amount:
            expense.original_currency = "USD"
            rate = await currency_service.get_exchange_rate(expense.transaction_date, db)
            expense.exchange_rate = rate
            expense.cad_amount = currency_service.convert_usd_to_cad(
                expense.original_amount, rate
            )
        else:
            expense.original_currency = "CAD"
            expense.exchange_rate = 1.0
            expense.cad_amount = expense.original_amount
        
        # Step 6: Match payment card
        if expense.card_last_4:
            source, _ = await match_card(db, current_user.id, expense.card_last_4)
            expense.payment_source = PaymentSource(source)
        
        # Mark as completed but NOT verified (user must review)
        expense.processing_status = "completed"
        expense.is_verified = False  # Requires user verification
        
        await db.commit()
        await db.refresh(expense)
        
        logger.info(f"Successfully processed expense {expense.id} via Google Native pipeline")
        
        return ExpenseResponse.model_validate(expense)
        
    except Exception as e:
        logger.error(f"Error processing expense {expense.id}: {str(e)}")
        expense.processing_status = "error"
        expense.error_message = str(e)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing receipt: {str(e)}"
        )


@router.get("/{expense_id}", response_model=ExpenseResponse)
async def get_expense(
    expense_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get a specific expense."""
    result = await db.execute(
        select(Expense).where(
            Expense.id == expense_id,
            Expense.user_id == current_user.id
        )
    )
    expense = result.scalar_one_or_none()
    
    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )
    
    return ExpenseResponse.model_validate(expense)


@router.patch("/{expense_id}", response_model=ExpenseResponse)
async def update_expense(
    expense_id: str,
    update_data: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update an expense after review.
    
    This is the verification step where users can correct
    any errors in the Gemini extraction before committing.
    """
    result = await db.execute(
        select(Expense).where(
            Expense.id == expense_id,
            Expense.user_id == current_user.id
        )
    )
    expense = result.scalar_one_or_none()
    
    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )
    
    # Apply updates
    if update_data.vendor_name is not None:
        expense.vendor_name = update_data.vendor_name
    
    if update_data.transaction_date is not None:
        expense.transaction_date = update_data.transaction_date
        # Recalculate exchange rate if date changed and it's USD
        if expense.original_currency == "USD":
            rate = await currency_service.get_exchange_rate(expense.transaction_date, db)
            expense.exchange_rate = rate
            if expense.original_amount:
                expense.cad_amount = currency_service.convert_usd_to_cad(
                    expense.original_amount, rate
                )
    
    if update_data.category is not None:
        try:
            expense.category = ExpenseCategory(update_data.category)
        except ValueError:
            pass
    
    if update_data.original_amount is not None:
        expense.original_amount = update_data.original_amount
        # Recalculate CAD amount
        expense.cad_amount = expense.original_amount * expense.exchange_rate
    
    # Update tax amounts separately
    if update_data.gst_amount is not None:
        expense.gst_amount = update_data.gst_amount
    if update_data.hst_amount is not None:
        expense.hst_amount = update_data.hst_amount
    if update_data.pst_amount is not None:
        expense.pst_amount = update_data.pst_amount
    
    # Recalculate total tax
    expense.tax_amount = (expense.gst_amount or 0) + (expense.hst_amount or 0) + (expense.pst_amount or 0)
    
    if update_data.notes is not None:
        expense.notes = update_data.notes
    
    if update_data.is_verified:
        expense.is_verified = True
    
    await db.commit()
    await db.refresh(expense)
    
    return ExpenseResponse.model_validate(expense)


@router.post("/{expense_id}/verify", response_model=ExpenseResponse)
async def verify_expense(
    expense_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark an expense as verified after user review."""
    result = await db.execute(
        select(Expense).where(
            Expense.id == expense_id,
            Expense.user_id == current_user.id
        )
    )
    expense = result.scalar_one_or_none()
    
    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )
    
    expense.is_verified = True
    await db.commit()
    await db.refresh(expense)
    
    return ExpenseResponse.model_validate(expense)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    expense_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete an expense and its receipt image from GCS."""
    result = await db.execute(
        select(Expense).where(
            Expense.id == expense_id,
            Expense.user_id == current_user.id
        )
    )
    expense = result.scalar_one_or_none()
    
    if not expense:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )
    
    # Delete receipt image from Google Cloud Storage
    if expense.receipt_image_url:
        await storage_service.delete_receipt(expense.receipt_image_url)
    
    await db.delete(expense)
    await db.commit()


@router.post("/manual", response_model=ExpenseResponse)
async def create_manual_expense(
    expense_data: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create an expense manually without a receipt."""
    # Calculate total tax from individual components
    total_tax = expense_data.gst_amount + expense_data.hst_amount + expense_data.pst_amount
    
    expense = Expense(
        user_id=current_user.id,
        vendor_name=expense_data.vendor_name,
        transaction_date=expense_data.transaction_date or datetime.utcnow(),
        category=ExpenseCategory(expense_data.category),
        original_amount=expense_data.original_amount,
        original_currency=expense_data.original_currency,
        gst_amount=expense_data.gst_amount,
        hst_amount=expense_data.hst_amount,
        pst_amount=expense_data.pst_amount,
        tax_amount=total_tax,
        notes=expense_data.notes,
        processing_status="completed",
        is_verified=True  # Manual entries are pre-verified
    )
    
    # Handle currency conversion
    if expense_data.original_currency == "USD" and expense_data.original_amount:
        expense.jurisdiction = Jurisdiction.USA
        rate = await currency_service.get_exchange_rate(expense.transaction_date, db)
        expense.exchange_rate = rate
        expense.cad_amount = currency_service.convert_usd_to_cad(
            expense_data.original_amount, rate
        )
    else:
        expense.jurisdiction = Jurisdiction.CANADA
        expense.exchange_rate = 1.0
        expense.cad_amount = expense_data.original_amount
    
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    
    return ExpenseResponse.model_validate(expense)
