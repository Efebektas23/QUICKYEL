"""Factoring Report parser - Parse J D Factors PDF reports using Gemini AI."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
import logging
import json
import base64
import google.generativeai as genai

from config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


# Gemini prompt for factoring report parsing
FACTORING_REPORT_PROMPT = """You are an expert Canadian accountant analyzing factoring reports from J D Factors for a trucking company (BACKTAS GLOBAL LOGISTICS ULC).

REPORT TYPES YOU MAY SEE:

1. RECOURSE REPORT: Shows invoices that were "recoursed" (sent back by the factor because the customer didn't pay).
   - Contains: Debtor name, Invoice#, Invoice Date, Post Date, Invoice Amount, Recourse Date, Recourse Amount
   - Recourse amounts represent money TAKEN BACK from the carrier's account
   - These should be recorded as NEGATIVE adjustments to revenue or as expenses

2. RESERVE REPORT: Shows reserve account activity with the factoring company.
   - Contains: Date, Check#, Transaction Type, Pay Type, Batch#, Description, Amount, Paid Date, Payee
   - Transaction types:
     * "CashPosting" / "Collection Report#XXX" = Collections (money coming in, no amount shown = informational)
     * "Fee Statement" / "Volume Rebate" = FACTORING FEES (these are EXPENSES - the amount shown is the fee charged)
     * "Purchase" / "Schedule#XXX" = Invoice purchases by factor (with amount = purchase fee/adjustment)
   - The amounts shown are significant entries (fees, adjustments)
   - The total at bottom (*) is the net reserve balance change

3. TREND ANALYSIS: Monthly summary of factoring activity.
   - Contains: Month, Beginning Balance, Purchases, Collections, C/B Debit, C/B Credit, Write Off, Ending Balance, Fees, A/R Turn
   - Key fields:
     * "Purchases" = Total invoices factored that month (this is GROSS REVENUE)
     * "Collections" = Payments received from customers
     * "Fees" = Factoring fees charged that month (this is an EXPENSE)
     * "A/R Turn" = Average days to collect

4. The report can be in CAD (CA1624) or USD (US1624).

EXTRACTION RULES:
- For TREND ANALYSIS: Extract monthly data with Purchases (revenue), Fees (expenses), Collections
- For RESERVE REPORT: Extract Fee Statement entries (these are factoring fee expenses) and Purchase entries (adjustments)
- For RECOURSE REPORT: Extract recoursed invoices (these reduce revenue or are expenses)

- Identify the CURRENCY from the report:
  * "CA1624" or "CAD" → currency is "CAD"
  * "US1624" or "USD" → currency is "USD"

RESPOND WITH ONLY THIS JSON (no markdown, no explanation):
{
  "report_type": "recourse_report" | "reserve_report" | "trend_analysis",
  "currency": "CAD" | "USD",
  "client_id": "string (e.g. CA1624 or US1624)",
  "date_range": {"start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null"},
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "type": "fee" | "purchase" | "collection" | "recourse" | "monthly_summary",
      "description": "string describing what this entry is",
      "amount": number (positive = expense/fee, use the actual amount shown),
      "category": "factoring_fees" for fees, "other_expenses" for recourse, "income" for purchases/collections,
      "reference": "batch#, invoice#, or month name",
      "debtor_name": "customer name if applicable, null otherwise"
    }
  ],
  "totals": {
    "total_fees": number (total factoring fees - this is the KEY expense number),
    "total_purchases": number (total invoices factored = gross revenue),
    "total_collections": number (total collected),
    "total_recourse": number (total recoursed amounts)
  },
  "confidence": number 0.0-1.0
}"""


class FactoringEntry(BaseModel):
    """Single entry from a factoring report."""
    date: Optional[str] = None
    type: str  # fee, purchase, collection, recourse, monthly_summary
    description: str
    amount: float = 0.0
    category: str = "factoring_fees"
    reference: Optional[str] = None
    debtor_name: Optional[str] = None


class FactoringTotals(BaseModel):
    """Summary totals from factoring report."""
    total_fees: float = 0.0
    total_purchases: float = 0.0
    total_collections: float = 0.0
    total_recourse: float = 0.0


class ParseFactoringRequest(BaseModel):
    """Request with PDF content as base64."""
    pdf_base64: str
    filename: Optional[str] = None


class ParseFactoringResponse(BaseModel):
    """Response with parsed factoring report data."""
    report_type: str
    currency: str = "CAD"
    client_id: Optional[str] = None
    date_range: dict = {}
    entries: List[FactoringEntry]
    totals: FactoringTotals
    confidence: float = 0.0


class FactoringReportParser:
    """Service for parsing factoring reports using Gemini AI."""
    
    def __init__(self):
        try:
            api_key = settings.gemini_api_key
            if not api_key:
                logger.warning("No Gemini API key found. Factoring parsing disabled.")
                self.model = None
                return
            
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(
                model_name="gemini-2.0-flash",
                generation_config={
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "max_output_tokens": 8192,
                }
            )
            logger.info("Factoring report parser initialized")
        except Exception as e:
            logger.error(f"Failed to initialize factoring parser: {str(e)}")
            self.model = None
    
    async def parse_pdf(self, pdf_content: bytes, filename: str = "") -> dict:
        """Parse a factoring report PDF using Gemini's multimodal capabilities."""
        if self.model is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Gemini AI service not available. Please check API key configuration."
            )
        
        try:
            # Create PDF part for Gemini
            pdf_part = {
                "mime_type": "application/pdf",
                "data": pdf_content
            }
            
            # Add filename context to help identification
            filename_hint = ""
            if filename:
                filename_hint = f"\nFILENAME HINT: {filename}"
            
            prompt = f"""Analyze this factoring report PDF from J D Factors carefully.
{filename_hint}

{FACTORING_REPORT_PROMPT}"""

            logger.info(f"Sending factoring PDF to Gemini ({len(pdf_content)} bytes, file: {filename})")
            response = self.model.generate_content([prompt, pdf_part])
            
            content = response.text.strip()
            logger.info(f"Gemini factoring response: {content[:500]}...")
            
            # Clean markdown if present
            if content.startswith("```"):
                lines = content.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                content = "\n".join(lines).strip()
            
            data = json.loads(content)
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini factoring response: {e}")
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not parse the factoring report. Please ensure it's a valid J D Factors report."
            )
        except Exception as e:
            logger.error(f"Factoring report parsing failed: {str(e)}", exc_info=True)
            raise


# Lazy initialization
_factoring_parser_instance = None

def get_factoring_parser() -> FactoringReportParser:
    global _factoring_parser_instance
    if _factoring_parser_instance is None:
        _factoring_parser_instance = FactoringReportParser()
    return _factoring_parser_instance


@router.post("/parse", response_model=ParseFactoringResponse)
async def parse_factoring_report(request: ParseFactoringRequest):
    """
    Parse a J D Factors PDF report using Gemini AI.
    
    Supports:
    - Recourse Reports (invoices sent back)
    - Reserve Reports (account activity, fees)
    - Trend Analysis (monthly summaries)
    
    Accepts PDF content as base64-encoded string.
    Returns structured data ready for review and import.
    """
    try:
        parser = get_factoring_parser()
        
        # Decode base64 PDF
        try:
            pdf_content = base64.b64decode(request.pdf_base64)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid PDF content. Please provide valid base64-encoded PDF."
            )
        
        # Verify it's a PDF
        if not pdf_content[:4] == b'%PDF':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File does not appear to be a valid PDF."
            )
        
        logger.info(f"Processing factoring report: {request.filename or 'unknown'} ({len(pdf_content)} bytes)")
        
        # Parse with Gemini
        result = await parser.parse_pdf(pdf_content, request.filename or "")
        
        # Build response
        entries = []
        for entry_data in result.get("entries", []):
            entries.append(FactoringEntry(
                date=entry_data.get("date"),
                type=entry_data.get("type", "fee"),
                description=entry_data.get("description", ""),
                amount=entry_data.get("amount", 0.0),
                category=entry_data.get("category", "factoring_fees"),
                reference=entry_data.get("reference"),
                debtor_name=entry_data.get("debtor_name"),
            ))
        
        totals_data = result.get("totals", {})
        totals = FactoringTotals(
            total_fees=totals_data.get("total_fees", 0.0),
            total_purchases=totals_data.get("total_purchases", 0.0),
            total_collections=totals_data.get("total_collections", 0.0),
            total_recourse=totals_data.get("total_recourse", 0.0),
        )
        
        response = ParseFactoringResponse(
            report_type=result.get("report_type", "unknown"),
            currency=result.get("currency", "CAD"),
            client_id=result.get("client_id"),
            date_range=result.get("date_range", {}),
            entries=entries,
            totals=totals,
            confidence=result.get("confidence", 0.5),
        )
        
        logger.info(f"Parsed factoring report: type={response.report_type}, "
                    f"currency={response.currency}, entries={len(entries)}, "
                    f"fees={totals.total_fees}")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing factoring report: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error parsing factoring report: {str(e)}"
        )
