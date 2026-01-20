"""Google Gemini Service via Google AI SDK for receipt parsing."""

import google.generativeai as genai
import json
from typing import Optional
import logging
from datetime import datetime
import os

from config import settings
from schemas import ParsedReceiptData

logger = logging.getLogger(__name__)


class GeminiService:
    """
    Service for parsing OCR text into structured expense data using Gemini.
    Uses Google AI SDK (simpler than Vertex AI).
    """
    
    SYSTEM_PROMPT = """You are an expert accountant for a Canadian logistics company. 
From the provided raw receipt text, extract the following information and return ONLY valid JSON.

EXTRACTION RULES:

1. VENDOR NAME: Extract the business/store name from the receipt header.

2. DATE: Find the MAIN TRANSACTION DATE (not "Printed on" date). Look for the date at the TOP of the receipt near the vendor name. Format as YYYY-MM-DD. IMPORTANT: Ignore any "Printed on", "Print Date", or footer dates - use only the primary purchase/transaction date.

3. JURISDICTION & PROVINCE DETECTION (CRITICAL):
   - "usa": US state abbreviations (TX, CA, OH), ZIP codes (5 digits), US phone format, "Sales Tax"
   - "canada": Canadian provinces, postal codes (A1A 1A1), tax labels GST/HST/PST
   - Look for address patterns, phone formats, and tax labels
   - Extract the PROVINCE code if in Canada (ON, BC, AB, SK, MB, QC, NB, NS, NL, PE, NT, NU, YT)

4. CURRENCY:
   - If jurisdiction is "usa" → currency is "USD"
   - If jurisdiction is "canada" → currency is "CAD"

5. TAX EXTRACTION (CRITICAL - Extract GST, HST, PST SEPARATELY):
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
   
   EXTRACTION LOGIC:
   * If receipt shows "HST" → put in hst_amount, set gst_amount=0
   * If receipt shows "GST" only → put in gst_amount, set hst_amount=0
   * If receipt shows "GST" + "PST" separately → extract both
   * If receipt shows "GST" + "QST" → put QST in pst_amount
   * Look for labels: "GST", "G.S.T.", "HST", "H.S.T.", "PST", "P.S.T.", "QST", "Q.S.T.", "TVQ"
   
   For USA: Set all tax amounts to 0 (US sales tax is NOT recoverable for Canadian businesses)

6. CATEGORY (map to exactly one - CRA T2125 compliant):
   - "fuel": Diesel, DEF, Pump, Gas, Fuel, Unleaded, Premium, Petro-Canada, Shell, Esso, Love's, Flying J, Pilot
   - "maintenance_repairs": Service, Parts, Tire, Mechanic, Oil Change, Repair, Lube, Canadian Tire, AutoZone
   - "insurance": Insurance Premium, Cargo Insurance, Liability, Intact, TD Insurance, Northbridge, Travelers
   - "licenses_dues": Govt, Permit, IFTA, License, Registration, MTO, DOT, Government, Membership, Dues
   - "tolls_scales": CAT Scale, E-ZPass, Toll, Bridge, Parking, Weigh, 407 ETR, Customs, Border
   - "meals_entertainment": Restaurant, Drive-thru, Cafe, Tim Hortons, McDonald's, Subway, Coffee, Market, Grocery, Meat, Food, Supermarket, Deli, Bakery, Pizza, Burger, Chicken, A&W, Wendy's, KFC, Popeyes, Starbucks, Dunkin
   - "travel_lodging": Hotel, Motel, Inn, Lodge, Stay, Room, Hampton, Holiday Inn, Best Western, Comfort Inn
   - "office_admin": Bank Fee, Software, Subscription, Supplies, Staples, Office Depot, Amazon, Best Buy, Phone, Internet
   - "other_expenses": Other business-related expenses that don't fit above categories
   - "uncategorized": ONLY if none of the above match - try hard to categorize!

7. CARD LAST 4: Look for patterns like "****1234", "VISA 5678", "MC 9012", "Card: XXXX1234"

8. TOTAL AMOUNT: Find the final total (after tax). Look for "Total", "Amount Due", "Grand Total".

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
    "hst_amount": number (HST 13-15% only, 0 if GST+PST province or USA),
    "pst_amount": number (PST/QST only, 0 if HST province or USA),
    "card_last_4": "4 digits or null",
    "confidence": number 0.0-1.0
}"""

    def __init__(self):
        """Initialize Google AI SDK with API key."""
        try:
            api_key = settings.gemini_api_key
            if not api_key:
                logger.warning("No Gemini API key found. AI parsing disabled.")
                self.model = None
                return
            
            genai.configure(api_key=api_key)
            
            self.model = genai.GenerativeModel(
                model_name="gemini-2.0-flash",
                generation_config={
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "max_output_tokens": 1024,
                }
            )
            
            logger.info("Gemini service initialized via Google AI SDK")
            
        except Exception as e:
            logger.error(f"Failed to initialize Gemini service: {str(e)}")
            self.model = None
    
    async def parse_receipt(self, ocr_text: str) -> ParsedReceiptData:
        """Parse OCR text into structured expense data using Gemini."""
        
        # Fallback if no model available
        if self.model is None:
            logger.warning("Gemini model not available, returning empty parsed data")
            return ParsedReceiptData(confidence=0.0)
        
        try:
            prompt = f"""{self.SYSTEM_PROMPT}

RAW RECEIPT TEXT:
\"\"\"
{ocr_text}
\"\"\"

EXTRACT AND RETURN JSON:"""

            response = self.model.generate_content(prompt)
            
            content = response.text.strip()
            logger.info(f"Gemini raw response: {content[:500]}...")
            
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
                confidence=data.get("confidence", 0.5)
            )
            
            logger.info(f"Parsed receipt: vendor={result.vendor_name}, "
                       f"amount={result.total_amount}, jurisdiction={result.jurisdiction}, "
                       f"province={result.province}, category={result.category}, "
                       f"gst={result.gst_amount}, hst={result.hst_amount}, pst={result.pst_amount}")
            
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {e}")
            return ParsedReceiptData(confidence=0.0)
            
        except Exception as e:
            logger.error(f"Gemini parsing failed: {str(e)}")
            raise


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
