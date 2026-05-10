"""Google Gemini Service via Google AI SDK for receipt parsing.

Enhanced with resilient AI wrapper:
- Exponential backoff retry (503/429/500)
- Model fallback (gemini-2.5-pro → gemini-2.5-flash)
- Circuit breaker (prevents cascade failures)
- Direct image vision: sends images directly to Gemini (no separate OCR needed)
"""

import google.generativeai as genai
import json
import base64
from typing import Optional, List
import logging
from datetime import datetime
import os

from config import settings
from schemas import ParsedReceiptData
from services.resilient_ai import ResilientModelFactory, extract_response_text

logger = logging.getLogger(__name__)


class GeminiService:
    """
    Service for parsing receipt/invoice images into structured expense data using Gemini.
    Uses Google AI SDK with resilient wrapper for retry/fallback/circuit breaker.
    
    Primary mode: Direct image vision (sends images directly to Gemini Pro/Flash).
    Fallback mode: OCR text parsing (if images unavailable, parse pre-extracted text).
    """
    
    SYSTEM_PROMPT = """You are an expert accountant for a Canadian logistics/trucking company. 
From the provided document (receipt OR invoice image), extract the following information and return ONLY valid JSON.

DOCUMENT TYPES YOU WILL SEE:
- Store receipts (supermarkets, gas stations, restaurants)
- Service invoices (medical tests, repairs, professional services)
- Government/permit invoices
- Utility bills
- Any business expense document

EXTRACTION RULES:

1. VENDOR NAME: Extract the business/company name. Look for:
   - Receipt header (store name)
   - Invoice header (company name, "From:", letterhead)
   - Look for Inc., Ltd., LLC, Corp., ULC after names

2. DATE: Find the MAIN TRANSACTION/INVOICE DATE. Format as YYYY-MM-DD.
   - For receipts: Date near the top, NOT "Printed on" date
   - For invoices: "Invoice Date", "Date", "Billing Date" - usually near invoice number
   - IMPORTANT: Ignore footer dates, "Amount Payable if Paid After" dates

3. JURISDICTION & PROVINCE DETECTION (CRITICAL):
   - "usa": US state abbreviations (TX, CA, OH), ZIP codes (5 digits), US phone format, "Sales Tax"
   - "canada": Canadian provinces, postal codes (A1A 1A1), tax labels GST/HST/PST
   - Look for address patterns, phone formats, and tax labels
   - Extract the PROVINCE code from the vendor's address (ON, BC, AB, SK, MB, QC, NB, NS, NL, PE, NT, NU, YT)
   - Common patterns: "City, ON A1A 1A1" or "City, Ontario"

4. CURRENCY:
   - If jurisdiction is "usa" → currency is "USD"
   - If jurisdiction is "canada" → currency is "CAD"
   - Look for explicit "Currency: CAD/USD" on invoices
   - If the transaction is in USD (US$, "USD", US Dollar): jurisdiction must be "usa" and gst_amount, hst_amount, pst_amount, tax_amount MUST all be 0 (no Canadian tax fields)

5. TAX EXTRACTION (CRITICAL - Extract GST, HST, PST SEPARATELY):
   - Only fill gst_amount / hst_amount / pst_amount when those tax lines are explicitly printed on the document.
   - Do NOT infer or calculate Canadian tax from category, subtotal, or gross total alone.
   Canadian Tax Rules by Province:
   
   HST PROVINCES (Harmonized Sales Tax - combines federal + provincial):
   - Ontario (ON): HST 13% - Extract as hst_amount ONLY
   - New Brunswick (NB): HST 15% - Extract as hst_amount ONLY
   - Newfoundland (NL): HST 15% - Extract as hst_amount ONLY
   - Nova Scotia (NS): HST 15% - Extract as hst_amount ONLY
   - Prince Edward Island (PE): HST 15% - Extract as hst_amount ONLY
   
   GST + PST PROVINCES (Separate taxes):
   - British Columbia (BC): GST 5% + PST 7% - Extract BOTH separately
   - Manitoba (MB): GST 5% + PST 7% - Extract BOTH separately
   - Saskatchewan (SK): GST 5% + PST 6% - Extract BOTH separately
   
   GST ONLY PROVINCES (No provincial sales tax):
   - Alberta (AB): GST 5% only - Extract as gst_amount
   - Northwest Territories (NT): GST 5% only
   - Nunavut (NU): GST 5% only
   - Yukon (YT): GST 5% only
   
   QUEBEC (QC): GST 5% + QST 9.975% - Extract QST as pst_amount
   
   IMPORTANT FOR INVOICES: 
   - Even if vendor is in Ontario (HST province), they may show "GST (5%)" separately
   - If invoice shows "GST 5%" → put in gst_amount (this is common for certain services)
   - If invoice shows "HST 13%" → put in hst_amount
   - Look for: "GST", "G.S.T.", "HST", "H.S.T.", "PST", "P.S.T.", "QST", "Tax"
   
   For USA / USD-priced receipts: Set gst_amount, hst_amount, pst_amount, and tax_amount to 0 (amount is converted to CAD elsewhere; never output Canadian GST/HST/PST for USD payments)

6. CATEGORY (map to exactly one - CRA T2125 compliant for trucking):
   - "fuel": Diesel, DEF, Pump, Gas, Fuel, Unleaded, Premium, Petro-Canada, Shell, Esso, Love's, Flying J, Pilot
   - "maintenance_repairs": Service, Parts, Tire, Mechanic, Oil Change, Repair, Lube, Canadian Tire, AutoZone, Body Shop
   - "insurance": Insurance Premium, Cargo Insurance, Liability, Intact, TD Insurance, Northbridge, Travelers
   - "licenses_dues": Government, Permit, IFTA, License, Registration, MTO, DOT, Membership, Dues, Medical Test, DriverCheck, Drug Test, Physical Exam, Driver Medical, Commercial License, Safety Certificate, Inspection
   - "tolls_scales": CAT Scale, E-ZPass, Toll, Bridge, Parking, Weigh, 407 ETR, Customs, Border
   - "meals_entertainment": Restaurant, Drive-thru, Cafe, Tim Hortons, McDonald's, Subway, Coffee, Market, Grocery, Meat, Food, Supermarket, Deli, Bakery, Pizza, Burger, Chicken, A&W, Wendy's, KFC, Popeyes, Starbucks, Dunkin
   - "travel_lodging": Hotel, Motel, Inn, Lodge, Stay, Room, Hampton, Holiday Inn, Best Western, Comfort Inn
   - "office_admin": Bank Fee, Software, Subscription, Supplies, Staples, Office Depot, Amazon, Best Buy, Phone, Internet
   - "other_expenses": Professional services, consulting, legal, accounting, other business expenses
   - "personal": Personal or clearly non-business purchases (not deductible on T2125)
   - "uncategorized": ONLY if none of the above match - try hard to categorize!

7. CARD LAST 4: Look for patterns like "****1234", "VISA 5678", "MC 9012", "Card: XXXX1234"
   - For invoices, this may not be present (payment pending) - return null

8. TOTAL AMOUNT: Find the final total (after tax). Look for:
   - Receipts: "Total", "Grand Total", "Amount Due"
   - Invoices: "Total Due", "Amount Due", "Invoice Total", "Balance Due"
   - NOT "Subtotal" - get the FINAL amount including tax

9. INVOICE/TRANSACTION NUMBER: Extract the most unique transaction identifier. Look for (in priority order):
   - "Invoice No", "Invoice #", "Inv #"
   - "Trans #", "Transaction #", "Trans No"
   - "Reference #", "Ref #"
   - "Auth #", "Authorization #", "Auth Code"
   - Any other unique receipt/transaction identifier
   - For gas station receipts, prefer Invoice No or Trans # over terminal numbers
   - Return the value as a string, or null if not found

10. DUPLICATE TEXT: If the receipt contains "*** DUPLICATE ***" or similar POS copy indicators,
    IGNORE it completely. This is a POS terminal copy indicator, NOT a transactional flag.
    It does NOT mean the transaction is a duplicate. Extract data normally.

RESPOND WITH ONLY THIS JSON (no markdown, no explanation):
{
    "vendor_name": "string or null",
    "transaction_date": "YYYY-MM-DD or null",
    "jurisdiction": "usa" | "canada" | "unknown",
    "province": "two-letter province code or null",
    "currency": "USD" | "CAD",
    "category": "exact category name from list above",
    "total_amount": number or null,
    "gst_amount": number (GST 5% only, 0 if HST province or USA),
    "hst_amount": number (HST 13-15% only, 0 if HST province or USA),
    "pst_amount": number (PST/QST only, 0 if HST province or USA),
    "card_last_4": "4 digits or null",
    "invoice_number": "string or null (most unique receipt/transaction identifier)",
    "confidence": number 0.0-1.0
}"""

    def __init__(self):
        """Initialize Gemini service with resilient AI wrapper."""
        try:
            api_key = settings.gemini_api_key
            if not api_key:
                logger.warning("No Gemini API key found. AI parsing disabled.")
                self.model_factory = None
                self.model = None
                return
            
            # Initialize resilient model factory (retry + fallback + circuit breaker)
            # Uses gemini-2.5-pro (best OCR/vision) → gemini-2.5-flash (fast fallback)
            #
            # IMPORTANT: gemini-2.5-* are "thinking" models whose internal reasoning
            # tokens are charged against max_output_tokens. Receipts with dense data
            # (QR codes, multiple line items, taxes) routinely consume 700–2200
            # thinking tokens before emitting any JSON. A 1024 cap silently truncates
            # output to "" → JSON decode fails → empty fields. Use 8192 to leave
            # ample budget for thinking + the ~200-token JSON payload.
            self.model_factory = ResilientModelFactory(
                api_key=api_key,
                primary_config={
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "max_output_tokens": 8192,
                }
            )
            
            # Keep self.model for backward compatibility checks
            self.model = self.model_factory.primary_model
            
            logger.info("Gemini service initialized with resilient AI wrapper (vision-capable)")
            
        except Exception as e:
            logger.error(f"Failed to initialize Gemini service: {str(e)}")
            self.model_factory = None
            self.model = None
    
    async def parse_receipt_from_images(self, image_contents: List[bytes]) -> ParsedReceiptData:
        """
        Parse receipt/invoice images directly using Gemini's built-in vision + OCR.
        
        This is the PRIMARY method — sends raw image bytes to Gemini Pro/Flash which
        has significantly better OCR than Google Cloud Vision for receipts/invoices.
        No separate OCR step needed.
        
        Args:
            image_contents: List of raw image bytes (one or more images of the same receipt)
            
        Returns:
            ParsedReceiptData with extracted fields
        """
        # Fallback if no model available
        if self.model_factory is None or not self.model_factory.is_available:
            logger.warning("Gemini models not available, returning empty parsed data")
            return ParsedReceiptData(confidence=0.0)
        
        try:
            # Build multimodal prompt: images + text instruction
            prompt_parts = []
            
            for i, img_bytes in enumerate(image_contents):
                # Detect MIME type from magic bytes
                mime_type = self._detect_mime_type(img_bytes)
                prompt_parts.append({
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": base64.b64encode(img_bytes).decode("utf-8")
                    }
                })
                logger.info(f"Added image {i+1}/{len(image_contents)} ({len(img_bytes)} bytes, {mime_type})")
            
            # Add text instruction after images
            if len(image_contents) == 1:
                instruction = f"""{self.SYSTEM_PROMPT}

The above is a receipt or invoice image. Read ALL text from the image carefully, then extract and return the JSON."""
            else:
                instruction = f"""{self.SYSTEM_PROMPT}

The above {len(image_contents)} images are parts of the SAME receipt or invoice (e.g., a long receipt photographed in multiple parts, top to bottom). Read ALL text from ALL images carefully, combine them as one document, then extract and return the JSON."""
            
            prompt_parts.append(instruction)
            
            total_bytes = sum(len(b) for b in image_contents)
            logger.info(f"Sending {len(image_contents)} image(s) ({total_bytes} bytes total) directly to Gemini Vision")
            
            # Use resilient generate with retry + fallback + circuit breaker
            response = self.model_factory.generate(
                prompt=prompt_parts,
                operation_name="receipt_vision_parsing",
            )
            
            content = extract_response_text(response).strip()
            logger.info(f"Gemini Vision raw response: {content[:500]}...")

            if not content:
                logger.error(
                    "Gemini Vision returned empty content — likely truncated mid-thinking. "
                    "Raising so the caller can surface a real error to the user."
                )
                raise ValueError(
                    "Gemini returned no text content for the receipt image. "
                    "This usually means max_output_tokens is too low for the model's "
                    "thinking budget. Try a larger limit or a simpler/clearer image."
                )

            return self._parse_gemini_response(content)

        except json.JSONDecodeError as e:
            logger.error(
                f"Failed to parse Gemini response as JSON: {e}. "
                "Surfacing the error instead of returning blank fields so the user "
                "sees a real failure rather than an apparently-successful empty result."
            )
            raise ValueError(
                f"Gemini response was not valid JSON ({e.msg}). The receipt could "
                "not be parsed — please retry or use manual entry."
            )

        except Exception as e:
            logger.error(f"Gemini Vision parsing failed: {str(e)}")
            raise

    async def parse_receipt(self, ocr_text: str) -> ParsedReceiptData:
        """
        Parse pre-extracted OCR text into structured expense data using Gemini.
        
        This is the FALLBACK method — used when image bytes are not available
        and only OCR text is provided (e.g., from Google Cloud Vision).
        
        For better accuracy, prefer parse_receipt_from_images() which sends
        images directly to Gemini's built-in vision.
        """
        
        # Fallback if no model available
        if self.model_factory is None or not self.model_factory.is_available:
            logger.warning("Gemini models not available, returning empty parsed data")
            return ParsedReceiptData(confidence=0.0)
        
        try:
            prompt = f"""{self.SYSTEM_PROMPT}

RAW DOCUMENT TEXT (receipt or invoice):
\"\"\"
{ocr_text}
\"\"\"

EXTRACT AND RETURN JSON:"""

            logger.info(f"Sending OCR text to Gemini ({len(ocr_text)} chars)")
            
            # Use resilient generate with retry + fallback + circuit breaker
            response = self.model_factory.generate(
                prompt=prompt,
                operation_name="receipt_parsing",
            )
            
            content = extract_response_text(response).strip()
            logger.info(f"Gemini raw response: {content[:500]}...")
            
            return self._parse_gemini_response(content)
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {e}")
            return ParsedReceiptData(confidence=0.0)
            
        except Exception as e:
            logger.error(f"Gemini parsing failed: {str(e)}")
            raise
    
    def _detect_mime_type(self, image_bytes: bytes) -> str:
        """Detect image MIME type from magic bytes."""
        if image_bytes[:4] == b'\x89PNG':
            return "image/png"
        elif image_bytes[:2] == b'\xff\xd8':
            return "image/jpeg"
        elif image_bytes[:4] == b'GIF8':
            return "image/gif"
        elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
            return "image/webp"
        elif image_bytes[4:12] == b'ftypheic' or image_bytes[4:12] == b'ftypmif1':
            return "image/heic"
        else:
            # Default to JPEG for unknown formats
            return "image/jpeg"
    
    def _parse_gemini_response(self, content: str) -> ParsedReceiptData:
        """Parse Gemini response text into ParsedReceiptData."""
        # Clean response if it has markdown code blocks
        if content.startswith("```"):
            lines = content.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            content = "\n".join(lines).strip()
        
        # Parse the JSON response
        data = json.loads(content)
        
        jurisdiction = data.get("jurisdiction", "unknown").lower()
        province = data.get("province")
        
        # Extract GST, HST, and PST separately
        if jurisdiction == "canada":
            gst_amount = data.get("gst_amount", 0.0)
            hst_amount = data.get("hst_amount", 0.0)
            pst_amount = data.get("pst_amount", 0.0)
        else:
            # US receipts - no recoverable tax
            gst_amount = 0.0
            hst_amount = 0.0
            pst_amount = 0.0
        
        # Total tax = sum of GST + HST + PST
        tax_amount = gst_amount + hst_amount + pst_amount
        
        result = ParsedReceiptData(
            vendor_name=data.get("vendor_name"),
            transaction_date=data.get("transaction_date"),
            jurisdiction=jurisdiction,
            province=province,
            category=data.get("category", "uncategorized").lower().replace(" ", "_"),
            total_amount=data.get("total_amount"),
            gst_amount=gst_amount,
            hst_amount=hst_amount,
            pst_amount=pst_amount,
            tax_amount=tax_amount,
            card_last_4=data.get("card_last_4"),
            invoice_number=data.get("invoice_number"),
            confidence=data.get("confidence", 0.5)
        )
        
        logger.info(f"Parsed receipt: vendor={result.vendor_name}, "
                   f"amount={result.total_amount}, jurisdiction={result.jurisdiction}, "
                   f"province={result.province}, category={result.category}, "
                   f"gst={result.gst_amount}, hst={result.hst_amount}, pst={result.pst_amount}")
        
        return result


# Lazy initialization - service will be created on first use
# This ensures Google credentials are set up before service initialization
_gemini_service_instance = None

def get_gemini_service() -> GeminiService:
    """Get or create Gemini service instance (lazy initialization)."""
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance

# For backward compatibility - use a class that acts like the service
class GeminiServiceProxy:
    """Proxy class that lazily initializes GeminiService on first access."""
    def __getattr__(self, name):
        return getattr(get_gemini_service(), name)

gemini_service = GeminiServiceProxy()
