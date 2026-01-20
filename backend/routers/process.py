"""Process receipt endpoint - OCR + Gemini only (no database)."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import logging
import httpx
from datetime import datetime

from services.ocr_service import ocr_service
from services.gemini_service import gemini_service
from services.currency_service import currency_service

router = APIRouter()
logger = logging.getLogger(__name__)


class ProcessReceiptRequest(BaseModel):
    """Request to process a receipt image (supports multiple images for long receipts)."""
    expense_id: str
    image_url: str
    image_urls: Optional[list[str]] = None  # Multiple images for long receipts


class ProcessReceiptResponse(BaseModel):
    """Response with parsed receipt data."""
    expense_id: str
    vendor_name: Optional[str] = None
    transaction_date: Optional[str] = None
    category: str = "uncategorized"
    jurisdiction: str = "unknown"
    total_amount: Optional[float] = None
    currency: str = "CAD"
    tax_amount: float = 0.0
    gst_amount: float = 0.0  # GST/HST only (ITC recoverable)
    pst_amount: float = 0.0  # PST only (not recoverable)
    exchange_rate: float = 1.0
    cad_amount: Optional[float] = None
    card_last_4: Optional[str] = None
    raw_text: Optional[str] = None
    confidence: float = 0.0


@router.post("/", response_model=ProcessReceiptResponse)
async def process_receipt(request: ProcessReceiptRequest):
    """
    Process a receipt image through OCR + Gemini pipeline.
    Supports multiple images for long receipts.
    
    1. Download image(s) from Firebase Storage URL
    2. Extract text with Google Cloud Vision OCR
    3. Parse with Gemini AI
    4. Convert currency if USD
    5. Return parsed data (frontend saves to Firestore)
    """
    try:
        logger.info(f"Processing receipt for expense {request.expense_id}")
        
        # Get all image URLs (support multiple images for long receipts)
        image_urls = request.image_urls if request.image_urls else [request.image_url]
        logger.info(f"Processing {len(image_urls)} image(s)")
        
        # Step 1 & 2: Download and OCR all images
        all_ocr_text = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            for i, url in enumerate(image_urls):
                logger.info(f"Downloading image {i+1}/{len(image_urls)}")
                response = await client.get(url)
                if response.status_code != 200:
                    logger.warning(f"Could not download image {i+1}: {url}")
                    continue
                
                image_content = response.content
                ocr_text = await ocr_service.extract_text_from_bytes(image_content)
                if ocr_text:
                    all_ocr_text.append(f"--- IMAGE {i+1} ---\n{ocr_text}")
                    logger.info(f"OCR extracted {len(ocr_text)} chars from image {i+1}")
        
        # Combine all OCR text
        ocr_text = "\n\n".join(all_ocr_text)
        
        if not ocr_text:
            return ProcessReceiptResponse(
                expense_id=request.expense_id,
                raw_text="",
                confidence=0.0
            )
        
        logger.info(f"OCR extracted {len(ocr_text)} characters")
        
        # Step 3: Parse with Gemini
        parsed_data = await gemini_service.parse_receipt(ocr_text)
        
        # Step 4: Currency conversion if USD
        exchange_rate = 1.0
        cad_amount = parsed_data.total_amount
        currency = "CAD"
        
        if parsed_data.jurisdiction == "usa" and parsed_data.total_amount:
            currency = "USD"
            # Get exchange rate for transaction date or today
            try:
                if parsed_data.transaction_date:
                    tx_date = datetime.strptime(parsed_data.transaction_date, "%Y-%m-%d")
                else:
                    tx_date = datetime.now()
                exchange_rate = await currency_service.get_exchange_rate_simple(tx_date)
                cad_amount = round(parsed_data.total_amount * exchange_rate, 2)
            except Exception as e:
                logger.error(f"Currency conversion error: {e}")
                exchange_rate = 1.40  # Fallback rate
                cad_amount = round(parsed_data.total_amount * exchange_rate, 2)
        
        return ProcessReceiptResponse(
            expense_id=request.expense_id,
            vendor_name=parsed_data.vendor_name,
            transaction_date=parsed_data.transaction_date,
            category=parsed_data.category or "uncategorized",
            jurisdiction=parsed_data.jurisdiction or "unknown",
            total_amount=parsed_data.total_amount,
            currency=currency,
            tax_amount=parsed_data.tax_amount or 0.0,
            gst_amount=parsed_data.gst_amount or 0.0,
            pst_amount=parsed_data.pst_amount or 0.0,
            exchange_rate=exchange_rate,
            cad_amount=cad_amount,
            card_last_4=parsed_data.card_last_4,
            raw_text=ocr_text,
            confidence=parsed_data.confidence or 0.5
        )
        
    except Exception as e:
        logger.error(f"Error processing receipt: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing receipt: {str(e)}"
        )

