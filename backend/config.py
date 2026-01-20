"""Application configuration settings - Google Native Stack."""

from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    database_url: str = "postgresql://postgres:password@localhost:5432/quickyel"
    
    # Google Cloud - All services use the same service account
    google_application_credentials: str = "./google-cloud-vision-key.json"
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
    cors_origins: str = "http://localhost:3000"
    
    # Debug
    debug: bool = True
    
    # Free Tier Limits
    vision_monthly_limit: int = 1000  # Max OCR requests per month
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins string into list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Set Google credentials environment variable
if settings.google_application_credentials:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
