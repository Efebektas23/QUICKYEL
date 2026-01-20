"""Application configuration settings - Google Native Stack."""

from pydantic_settings import BaseSettings
from typing import List, Optional
import os
import json
import tempfile
import logging


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    database_url: str = "postgresql://postgres:password@localhost:5432/quickyel"
    
    # Google Cloud - All services use the same service account
    google_application_credentials: str = "./google-cloud-vision-key.json"
    google_application_credentials_json: Optional[str] = None  # For Railway deployment (GOOGLE_APPLICATION_CREDENTIALS_JSON)
    google_credentials_json: Optional[str] = None  # Alternative name (GOOGLE_CREDENTIALS_JSON)
    google_cloud_project: str = "quickyeliz"
    gcs_bucket_name: str = "quickyeliz.firebasestorage.app"
    
    # Firebase Admin (for backend operations)
    firebase_admin_credentials: str = "./firebase-admin-key.json"
    
    # Gemini API Key
    gemini_api_key: str = "AIzaSyAkpM2NjfcmgemxW8LHFJz8FM0nxELWMfQ"
    
    # JWT
    jwt_secret: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24 hours
    
    # CORS
    cors_origins: str = "http://localhost:3000"  # Default for local development
    
    # Debug
    debug: bool = True
    
    # Free Tier Limits
    vision_monthly_limit: int = 1000  # Max OCR requests per month
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins string into list."""
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        
        # Add trailing slash versions for Railway compatibility
        # Railway URLs sometimes have trailing slashes, sometimes don't
        expanded_origins = []
        for origin in origins:
            expanded_origins.append(origin)
            # Add trailing slash version if it doesn't exist
            if origin.endswith("/"):
                expanded_origins.append(origin.rstrip("/"))
            else:
                expanded_origins.append(origin + "/")
        
        # Remove duplicates while preserving order
        seen = set()
        unique_origins = []
        for origin in expanded_origins:
            if origin not in seen:
                seen.add(origin)
                unique_origins.append(origin)
        
        return unique_origins
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()


def setup_google_credentials():
    """
    Setup Google Cloud credentials for Railway deployment.
    
    Railway doesn't have a file system, so we use environment variable with JSON content.
    This function creates a temporary file from JSON string and sets GOOGLE_APPLICATION_CREDENTIALS.
    Should be called during application startup.
    
    Supports both GOOGLE_APPLICATION_CREDENTIALS_JSON and GOOGLE_CREDENTIALS_JSON environment variables.
    """
    logger = logging.getLogger(__name__)
    
    # Try GOOGLE_APPLICATION_CREDENTIALS_JSON first, then GOOGLE_CREDENTIALS_JSON
    credentials_json = settings.google_application_credentials_json or settings.google_credentials_json
    
    if credentials_json:
        # Create temporary file with credentials JSON
        try:
            credentials_data = json.loads(credentials_json)
            # Use tempfile for secure temporary file creation
            temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
            json.dump(credentials_data, temp_file, indent=2)
            temp_file.close()
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_file.name
            logger.info(f"Created temporary Google Cloud credentials file: {temp_file.name}")
            return temp_file.name
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Google credentials JSON: {e}")
            logger.error("Please check GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_JSON environment variable")
            # Fallback to file path if JSON parsing fails
            if settings.google_application_credentials and os.path.exists(settings.google_application_credentials):
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
                logger.info(f"Using fallback credentials file: {settings.google_application_credentials}")
                return settings.google_application_credentials
        except Exception as e:
            logger.error(f"Failed to create credentials file: {e}")
            if settings.google_application_credentials and os.path.exists(settings.google_application_credentials):
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
                logger.info(f"Using fallback credentials file: {settings.google_application_credentials}")
                return settings.google_application_credentials
    elif settings.google_application_credentials and os.path.exists(settings.google_application_credentials):
        # Use file path (local development)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
        logger.info(f"Using local credentials file: {settings.google_application_credentials}")
        return settings.google_application_credentials
    else:
        logger.warning("⚠️ No Google Cloud credentials found!")
        logger.warning("⚠️ Please set GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_JSON environment variable")
        logger.warning("⚠️ Or provide google-cloud-vision-key.json file for local development")
    
    return None
