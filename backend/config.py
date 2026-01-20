"""Application configuration settings - Google Native Stack."""

from pydantic_settings import BaseSettings
from typing import List, Optional
import os
import json
import tempfile


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    database_url: str = "postgresql://postgres:password@localhost:5432/quickyel"
    
    # Google Cloud - All services use the same service account
    google_application_credentials: str = "./google-cloud-vision-key.json"
    google_application_credentials_json: Optional[str] = None  # For Railway deployment
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

# Handle Google Cloud credentials for Railway deployment
# Railway doesn't have a file system, so we use environment variable with JSON content
if settings.google_application_credentials_json:
    # Create temporary file with credentials JSON
    try:
        credentials_data = json.loads(settings.google_application_credentials_json)
        temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
        json.dump(credentials_data, temp_file)
        temp_file.close()
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_file.name
        print(f"Created temporary credentials file: {temp_file.name}")
    except json.JSONDecodeError as e:
        print(f"Warning: Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: {e}")
        # Fallback to file path if JSON parsing fails
        if settings.google_application_credentials:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
    except Exception as e:
        print(f"Warning: Failed to create credentials file: {e}")
        if settings.google_application_credentials:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
elif settings.google_application_credentials:
    # Use file path (local development)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
