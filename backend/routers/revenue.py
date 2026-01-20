"""Process Rate Confirmation endpoint - OCR + Gemini for revenue parsing."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import logging
import httpx
import json
import tempfile
import os
import google.generativeai as genai

from config import settings
from services.ocr_service import ocr_service

router = APIRouter()
logger = logging.getLogger(__name__)


def is_pdf_content(content: bytes) -> bool:
    """Check if content is a PDF file by looking at magic bytes."""
    return content[:4] == b'%PDF'


def is_pdf_url(url: str) -> bool:
    """Check if URL appears to be a PDF."""
    return '.pdf' in url.lower()


class ProcessRateConfirmationRequest(BaseModel):
    """Request to process a Rate Confirmation document."""
    image_url: str


class ProcessRateConfirmationResponse(BaseModel):
    """Response with parsed Rate Confirmation data."""
    broker_name: Optional[str] = None
    load_id: Optional[str] = None
    date: Optional[str] = None  # YYYY-MM-DD format
    amount_original: Optional[float] = None
    currency: str = "USD"  # USD or CAD
    raw_text: Optional[str] = None
    confidence: float = 0.0


# Gemini prompt for Rate Confirmation parsing
RATE_CONFIRMATION_PROMPT = """You are an expert logistics and freight accounting assistant.
From the provided Rate Confirmation or Load Confirmation document text, extract the following information.

EXTRACTION RULES:

1. BROKER/COMPANY NAME: 
   - Look for "RXO", "C.H. Robinson", "TQL", "Coyote", "Echo", "XPO", "Uber Freight", etc.
   - Usually appears at the top of the document or in the header.

2. LOAD ID / ORDER NUMBER:
   - Look for patterns like "Load Confirmation #", "Order #", "Load #", "Confirmation #", "PRO #"
   - Extract the alphanumeric identifier.

3. TRANSACTION DATE:
   - For RXO: Use the "CREATED" date
   - For C.H. Robinson: Use "Pick Up Date" or "Ship Date"
   - For others: Use the earliest date that appears to be the service date
   - Format as YYYY-MM-DD

4. AMOUNT & CURRENCY DETECTION (CRITICAL):
   - **CAD Detection:** Look for "C$", "CAD", "Canadian Dollar", or amounts prefixed with "C$"
     Example: "C$475.00" or "CAD 475.00" → currency is "CAD"
   
   - **USD Detection:** Look for plain "$" without "C", "USD", "US Dollar", or "U.S."
     Example: "$1,250.00" or "USD 1,250.00" → currency is "USD"
   
   - Extract the TOTAL amount (Line Haul, Total Carrier Pay, Carrier Rate, or similar)
   - Look for labels like: "TOTAL", "Line Haul", "Carrier Pay", "Rate", "Amount Due"

5. IMPORTANT CURRENCY RULES:
   - If you see "C$" → currency is "CAD"
   - If you see just "$" without "C" → currency is "USD"  
   - Canadian locations (provinces like ON, AB, BC) may indicate CAD
   - US locations (states like TX, CA, OH) typically indicate USD

RESPOND WITH ONLY THIS JSON (no markdown, no explanation):
{
    "broker_name": "string or null",
    "load_id": "string or null",
    "date": "YYYY-MM-DD or null",
    "amount": number or null,
    "currency": "USD" or "CAD",
    "confidence": number 0.0-1.0
}"""


class RateConfirmationParser:
    """Service for parsing Rate Confirmation documents using Gemini."""
    
    def __init__(self):
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
            
            logger.info("Rate Confirmation parser initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize Rate Confirmation parser: {str(e)}")
            self.model = None
    
    def _parse_gemini_response(self, content: str) -> dict:
        """Parse Gemini response JSON, cleaning markdown if present."""
        content = content.strip()
        
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
        
        return {
            "broker_name": data.get("broker_name"),
            "load_id": data.get("load_id"),
            "date": data.get("date"),
            "amount": data.get("amount"),
            "currency": data.get("currency", "USD").upper(),
            "confidence": data.get("confidence", 0.5)
        }
    
    async def parse_from_text(self, ocr_text: str) -> dict:
        """Parse OCR text from Rate Confirmation into structured data."""
        
        if self.model is None:
            logger.warning("Gemini model not available, returning empty parsed data")
            return self._empty_result()
        
        try:
            prompt = f"""{RATE_CONFIRMATION_PROMPT}

RATE CONFIRMATION TEXT:
\"\"\"
{ocr_text}
\"\"\"

EXTRACT AND RETURN JSON:"""

            response = self.model.generate_content(prompt)
            
            content = response.text.strip()
            logger.info(f"Gemini response for Rate Confirmation (text): {content[:500]}...")
            
            return self._parse_gemini_response(content)
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {e}")
            return self._empty_result()
            
        except Exception as e:
            logger.error(f"Rate Confirmation text parsing failed: {str(e)}")
            raise
    
    async def parse_from_pdf(self, pdf_content: bytes) -> dict:
        """Parse PDF directly using Gemini's multimodal capabilities."""
        
        if self.model is None:
            logger.warning("Gemini model not available, returning empty parsed data")
            return self._empty_result()
        
        try:
            # Save PDF to temp file for Gemini upload
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_file:
                tmp_file.write(pdf_content)
                tmp_path = tmp_file.name
            
            try:
                # Upload PDF to Gemini File API
                logger.info(f"Uploading PDF to Gemini File API ({len(pdf_content)} bytes)...")
                uploaded_file = genai.upload_file(tmp_path, mime_type="application/pdf")
                logger.info(f"PDF uploaded successfully: {uploaded_file.name}")
                
                # Create prompt for PDF parsing
                prompt = f"""Look at this Rate Confirmation / Load Confirmation PDF document carefully.

{RATE_CONFIRMATION_PROMPT}"""

                # Send to Gemini with the PDF
                response = self.model.generate_content([prompt, uploaded_file])
                
                content = response.text.strip()
                logger.info(f"Gemini response for Rate Confirmation (PDF): {content[:500]}...")
                
                return self._parse_gemini_response(content)
                
            finally:
                # Clean up temp file
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini PDF response as JSON: {e}")
            return self._empty_result()
            
        except Exception as e:
            logger.error(f"Rate Confirmation PDF parsing failed: {str(e)}")
            raise
    
    async def parse_from_image(self, image_content: bytes, mime_type: str = "image/jpeg") -> dict:
        """Parse image directly using Gemini's vision capabilities."""
        
        if self.model is None:
            logger.warning("Gemini model not available, returning empty parsed data")
            return self._empty_result()
        
        try:
            # Create image part for Gemini
            image_part = {
                "mime_type": mime_type,
                "data": image_content
            }
            
            prompt = f"""Look at this Rate Confirmation / Load Confirmation image carefully.

{RATE_CONFIRMATION_PROMPT}"""

            # Send to Gemini with the image
            response = self.model.generate_content([prompt, image_part])
            
            content = response.text.strip()
            logger.info(f"Gemini response for Rate Confirmation (image): {content[:500]}...")
            
            return self._parse_gemini_response(content)
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini image response as JSON: {e}")
            return self._empty_result()
            
        except Exception as e:
            logger.error(f"Rate Confirmation image parsing failed: {str(e)}")
            raise
    
    def _empty_result(self) -> dict:
        """Return empty result structure."""
        return {
            "broker_name": None,
            "load_id": None,
            "date": None,
            "amount": None,
            "currency": "USD",
            "confidence": 0.0
        }
    
    # Keep old method for backward compatibility
    async def parse(self, ocr_text: str) -> dict:
        """Alias for parse_from_text."""
        return await self.parse_from_text(ocr_text)


# Singleton instance
rate_confirmation_parser = RateConfirmationParser()


@router.post("/", response_model=ProcessRateConfirmationResponse)
async def process_rate_confirmation(request: ProcessRateConfirmationRequest):
    """
    Process a Rate Confirmation document through Gemini AI.
    
    Supports:
    - PDF files: Parsed directly by Gemini (no OCR needed)
    - Image files: Parsed directly by Gemini vision
    
    Steps:
    1. Download file from Firebase Storage URL
    2. Detect file type (PDF vs image)
    3. Parse with Gemini AI (specialized for Rate Confirmations)
    4. Detect currency (CAD vs USD)
    5. Return parsed data (frontend handles FX conversion)
    """
    try:
        logger.info(f"Processing Rate Confirmation: {request.image_url[:80]}...")
        
        # Step 1: Download file
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(request.image_url)
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Could not download Rate Confirmation file"
                )
            file_content = response.content
        
        logger.info(f"Downloaded file: {len(file_content)} bytes")
        
        # Step 2: Detect file type and parse accordingly
        raw_text = ""
        
        if is_pdf_content(file_content) or is_pdf_url(request.image_url):
            # PDF file - use Gemini directly
            logger.info("Detected PDF file - using Gemini direct PDF parsing")
            parsed_data = await rate_confirmation_parser.parse_from_pdf(file_content)
            raw_text = "[Parsed directly from PDF by Gemini]"
        else:
            # Image file - use Gemini vision
            logger.info("Detected image file - using Gemini vision")
            
            # Determine MIME type from content
            mime_type = "image/jpeg"  # default
            if file_content[:8] == b'\x89PNG\r\n\x1a\n':
                mime_type = "image/png"
            elif file_content[:2] == b'GI':  # GIF89a or GIF87a
                mime_type = "image/gif"
            elif file_content[:4] == b'RIFF':  # WebP
                mime_type = "image/webp"
            
            parsed_data = await rate_confirmation_parser.parse_from_image(file_content, mime_type)
            raw_text = "[Parsed directly from image by Gemini]"
        
        logger.info(f"Parsed data: broker={parsed_data.get('broker_name')}, "
                   f"amount={parsed_data.get('amount')}, currency={parsed_data.get('currency')}")
        
        return ProcessRateConfirmationResponse(
            broker_name=parsed_data.get("broker_name"),
            load_id=parsed_data.get("load_id"),
            date=parsed_data.get("date"),
            amount_original=parsed_data.get("amount"),
            currency=parsed_data.get("currency", "USD"),
            raw_text=raw_text,
            confidence=parsed_data.get("confidence", 0.5)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing Rate Confirmation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing Rate Confirmation: {str(e)}"
        )

