"""Process receipt endpoint - Direct Gemini Vision (no separate OCR step).

Sends receipt/invoice images directly to Gemini Pro/Flash for combined
OCR + parsing. This eliminates the old Google Cloud Vision OCR step which
frequently returned empty results for receipts.
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import logging
import httpx
from datetime import datetime

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
    """Response with parsed receipt/invoice data."""
    expense_id: str
    vendor_name: Optional[str] = None
    transaction_date: Optional[str] = None
    category: str = "uncategorized"
    jurisdiction: str = "unknown"
    total_amount: Optional[float] = None
    currency: str = "CAD"
    tax_amount: float = 0.0
    gst_amount: float = 0.0  # GST only (5%) - ITC recoverable
    hst_amount: float = 0.0  # HST only (13-15%) - ITC recoverable
    pst_amount: float = 0.0  # PST only (6-10%) - NOT recoverable
    exchange_rate: float = 1.0
    cad_amount: Optional[float] = None
    card_last_4: Optional[str] = None
    invoice_number: Optional[str] = None  # Unique transaction/invoice/auth identifier
    raw_text: Optional[str] = None
    confidence: float = 0.0


@router.post("/", response_model=ProcessReceiptResponse)
async def process_receipt(request: ProcessReceiptRequest):
    """
    Process a receipt image through Gemini Vision pipeline (direct image → AI).
    Supports multiple images for long receipts.
    
    1. Download image(s) from Firebase Storage URL
    2. Send images directly to Gemini Pro/Flash for OCR + parsing (single step)
    3. Convert currency if USD
    4. Return parsed data (frontend saves to Firestore)
    
    NOTE: This bypasses the old Google Cloud Vision OCR step entirely.
    Gemini's built-in vision has significantly better OCR for receipts/invoices.
    """
    try:
        logger.info(f"Processing receipt for expense {request.expense_id}")
        
        # Get all image URLs (support multiple images for long receipts)
        image_urls = request.image_urls if request.image_urls else [request.image_url]
        logger.info(f"Processing {len(image_urls)} image(s) via Gemini Vision (direct)")
        
        # Step 1: Download all images as raw bytes
        image_contents = []
        async with httpx.AsyncClient(timeout=60.0) as client:  # Increased timeout for larger invoice images
            for i, url in enumerate(image_urls):
                logger.info(f"Downloading image {i+1}/{len(image_urls)}")
                response = await client.get(url)
                if response.status_code != 200:
                    logger.warning(f"Could not download image {i+1}: {url}")
                    continue
                
                image_bytes = response.content
                if len(image_bytes) > 0:
                    image_contents.append(image_bytes)
                    logger.info(f"Downloaded image {i+1}: {len(image_bytes)} bytes")
                else:
                    logger.warning(f"Image {i+1} is empty (0 bytes)")
        
        if not image_contents:
            logger.error("No images could be downloaded")
            return ProcessReceiptResponse(
                expense_id=request.expense_id,
                raw_text="",
                confidence=0.0
            )
        
        total_bytes = sum(len(b) for b in image_contents)
        logger.info(f"Downloaded {len(image_contents)} image(s), {total_bytes} bytes total")
        
        # Step 2: Send images directly to Gemini Vision for OCR + parsing (single step)
        parsed_data = await gemini_service.parse_receipt_from_images(image_contents)
        
        # Step 3: Currency conversion if USD
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

        tax_amount = parsed_data.tax_amount or 0.0
        gst_amount = parsed_data.gst_amount or 0.0
        hst_amount = parsed_data.hst_amount or 0.0
        pst_amount = parsed_data.pst_amount or 0.0
        if currency == "USD":
            tax_amount = 0.0
            gst_amount = 0.0
            hst_amount = 0.0
            pst_amount = 0.0
        
        return ProcessReceiptResponse(
            expense_id=request.expense_id,
            vendor_name=parsed_data.vendor_name,
            transaction_date=parsed_data.transaction_date,
            category=parsed_data.category or "uncategorized",
            jurisdiction=parsed_data.jurisdiction or "unknown",
            total_amount=parsed_data.total_amount,
            currency=currency,
            tax_amount=tax_amount,
            gst_amount=gst_amount,
            hst_amount=hst_amount,
            pst_amount=pst_amount,
            exchange_rate=exchange_rate,
            cad_amount=cad_amount,
            card_last_4=parsed_data.card_last_4,
            invoice_number=parsed_data.invoice_number,
            raw_text=f"[Gemini Vision - {len(image_contents)} image(s), {total_bytes} bytes]",
            confidence=parsed_data.confidence or 0.5
        )
        
    except Exception as e:
        logger.error(f"Error processing receipt: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing receipt: {str(e)}"
        )
