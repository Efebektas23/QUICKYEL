"""Google Cloud Vision OCR Service with Free Tier Rate Limiting."""

from google.cloud import vision
from google.cloud.vision_v1 import types
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta
from typing import Optional
import logging

from config import settings

logger = logging.getLogger(__name__)


class OCRService:
    """Service for extracting text from receipt images using Google Cloud Vision.
    
    Implements rate limiting to stay within the Google Cloud Vision Free Tier
    (1,000 requests per month).
    """
    
    def __init__(self):
        """Initialize the Vision API client."""
        self.client = vision.ImageAnnotatorClient()
        self.monthly_limit = settings.vision_monthly_limit
        logger.info(f"OCR Service initialized with monthly limit: {self.monthly_limit}")
    
    async def check_rate_limit(self, db: Optional[AsyncSession] = None) -> tuple[bool, int]:
        """
        Check if we're within the monthly OCR request limit.
        
        Args:
            db: Database session for checking usage
            
        Returns:
            Tuple of (is_allowed, remaining_requests)
        """
        if not db:
            # If no DB session, allow the request but log warning
            logger.warning("Rate limit check skipped - no DB session")
            return True, self.monthly_limit
        
        try:
            # Import here to avoid circular import
            from models import Expense
            
            # Get the first day of current month
            today = datetime.utcnow()
            month_start = datetime(today.year, today.month, 1)
            
            # Count OCR requests this month (expenses with receipt images)
            result = await db.execute(
                select(func.count(Expense.id)).where(
                    Expense.receipt_image_url.isnot(None),
                    Expense.created_at >= month_start
                )
            )
            monthly_count = result.scalar() or 0
            
            remaining = max(0, self.monthly_limit - monthly_count)
            is_allowed = remaining > 0
            
            if not is_allowed:
                logger.warning(f"OCR rate limit reached: {monthly_count}/{self.monthly_limit} this month")
            
            return is_allowed, remaining
            
        except Exception as e:
            logger.error(f"Rate limit check failed: {str(e)}")
            return True, self.monthly_limit  # Allow on error to not block users
    
    async def extract_text(
        self, 
        image_content: bytes,
        db: Optional[AsyncSession] = None
    ) -> Optional[str]:
        """
        Extract text from an image using Google Cloud Vision.
        
        Uses DOCUMENT_TEXT_DETECTION for better receipt parsing.
        This is within the free tier limits (1,000/month).
        
        Args:
            image_content: Raw image bytes
            db: Optional database session for rate limiting
            
        Returns:
            Extracted text string or None if failed/rate limited
        """
        # Check rate limit
        is_allowed, remaining = await self.check_rate_limit(db)
        if not is_allowed:
            logger.error("OCR request blocked - monthly limit reached")
            raise Exception(f"Monthly OCR limit ({self.monthly_limit}) reached. Please try again next month or upgrade your plan.")
        
        try:
            # Create the image object
            image = types.Image(content=image_content)
            
            # Use document_text_detection for better structured text
            # This is the standard pre-trained model (no AutoML)
            response = self.client.document_text_detection(image=image)
            
            if response.error.message:
                logger.error(f"Vision API error: {response.error.message}")
                return None
            
            # Get the full text annotation
            if response.full_text_annotation:
                text = response.full_text_annotation.text
                logger.info(f"OCR extracted {len(text)} characters (Remaining this month: {remaining - 1})")
                return text
            
            # Fallback to text_annotations if full_text not available
            if response.text_annotations:
                text = response.text_annotations[0].description
                logger.info(f"OCR extracted {len(text)} characters via fallback (Remaining: {remaining - 1})")
                return text
            
            logger.warning("No text found in image")
            return None
            
        except Exception as e:
            logger.error(f"OCR extraction failed: {str(e)}")
            raise
    
    async def extract_text_from_url(
        self, 
        image_url: str,
        db: Optional[AsyncSession] = None
    ) -> Optional[str]:
        """
        Extract text from an image URL.
        
        Args:
            image_url: URL of the image
            db: Optional database session for rate limiting
            
        Returns:
            Extracted text string or None if failed
        """
        # Check rate limit
        is_allowed, remaining = await self.check_rate_limit(db)
        if not is_allowed:
            raise Exception(f"Monthly OCR limit ({self.monthly_limit}) reached.")
        
        try:
            image = types.Image()
            image.source.image_uri = image_url
            
            response = self.client.document_text_detection(image=image)
            
            if response.error.message:
                logger.error(f"Vision API error: {response.error.message}")
                return None
            
            if response.full_text_annotation:
                return response.full_text_annotation.text
            
            if response.text_annotations:
                return response.text_annotations[0].description
            
            return None
            
        except Exception as e:
            logger.error(f"OCR extraction from URL failed: {str(e)}")
            raise
    
    async def get_usage_stats(self, db: AsyncSession) -> dict:
        """
        Get OCR usage statistics for the current month.
        
        Args:
            db: Database session
            
        Returns:
            Dict with usage stats
        """
        try:
            from models import Expense
            
            today = datetime.utcnow()
            month_start = datetime(today.year, today.month, 1)
            
            result = await db.execute(
                select(func.count(Expense.id)).where(
                    Expense.receipt_image_url.isnot(None),
                    Expense.created_at >= month_start
                )
            )
            monthly_count = result.scalar() or 0
            
            return {
                "month": today.strftime("%B %Y"),
                "used": monthly_count,
                "limit": self.monthly_limit,
                "remaining": max(0, self.monthly_limit - monthly_count),
                "percentage_used": round((monthly_count / self.monthly_limit) * 100, 1)
            }
            
        except Exception as e:
            logger.error(f"Failed to get usage stats: {str(e)}")
            return {
                "error": str(e),
                "limit": self.monthly_limit
            }


    async def extract_text_from_bytes(self, image_content: bytes) -> Optional[str]:
        """
        Extract text from image bytes without rate limiting (for Firebase flow).
        """
        try:
            image = types.Image(content=image_content)
            response = self.client.document_text_detection(image=image)
            
            if response.error.message:
                logger.error(f"Vision API error: {response.error.message}")
                return None
            
            if response.full_text_annotation:
                return response.full_text_annotation.text
            
            if response.text_annotations:
                return response.text_annotations[0].description
            
            return None
            
        except Exception as e:
            logger.error(f"OCR extraction failed: {str(e)}")
            raise


# Lazy initialization - service will be created on first use
# This ensures Google credentials are set up before service initialization
_ocr_service_instance = None

def get_ocr_service() -> OCRService:
    """Get or create OCR service instance (lazy initialization)."""
    global _ocr_service_instance
    if _ocr_service_instance is None:
        _ocr_service_instance = OCRService()
    return _ocr_service_instance

# For backward compatibility - use a class that acts like the service
class OCRServiceProxy:
    """Proxy class that lazily initializes OCRService on first access."""
    def __getattr__(self, name):
        return getattr(get_ocr_service(), name)

ocr_service = OCRServiceProxy()
