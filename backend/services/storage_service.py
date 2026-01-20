"""Google Cloud Storage Service for receipt images."""

from google.cloud import storage
from google.cloud.exceptions import NotFound
import uuid
from datetime import datetime, timedelta
from typing import Optional
import logging

from config import settings

logger = logging.getLogger(__name__)


class StorageService:
    """Service for uploading and managing receipt images in Google Cloud Storage."""
    
    def __init__(self):
        """Initialize GCS client using service account."""
        try:
            self.client = storage.Client(project=settings.google_cloud_project)
            self.bucket_name = settings.gcs_bucket_name
            self._ensure_bucket_exists()
            logger.info(f"GCS Storage service initialized with bucket: {self.bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize GCS client: {str(e)}")
            self.client = None
    
    def _ensure_bucket_exists(self):
        """Create the receipts bucket if it doesn't exist."""
        try:
            bucket = self.client.bucket(self.bucket_name)
            
            if not bucket.exists():
                # Create bucket in the same region as the project
                bucket = self.client.create_bucket(
                    self.bucket_name,
                    location="us-central1"  # Choose appropriate region
                )
                
                # Set lifecycle rule to delete old receipts after 7 years (CRA requirement)
                bucket.add_lifecycle_delete_rule(age=2555)  # ~7 years
                bucket.patch()
                
                logger.info(f"Created GCS bucket: {self.bucket_name}")
            else:
                logger.info(f"Using existing GCS bucket: {self.bucket_name}")
                
        except Exception as e:
            logger.error(f"Failed to ensure bucket exists: {str(e)}")
            raise
    
    async def upload_receipt(
        self, 
        file_content: bytes, 
        user_id: str,
        file_extension: str = "jpg"
    ) -> Optional[str]:
        """
        Upload a receipt image to Google Cloud Storage.
        
        Args:
            file_content: Raw file bytes
            user_id: ID of the uploading user
            file_extension: File extension (jpg, png, etc.)
            
        Returns:
            Signed URL of the uploaded file or None if failed
        """
        if not self.client:
            logger.warning("GCS client not initialized")
            return None
        
        try:
            bucket = self.client.bucket(self.bucket_name)
            
            # Generate unique filename with user folder structure
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            filename = f"receipts/{user_id}/{timestamp}_{uuid.uuid4().hex[:8]}.{file_extension}"
            
            # Create blob
            blob = bucket.blob(filename)
            
            # Determine content type
            content_type_map = {
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "png": "image/png",
                "gif": "image/gif",
                "webp": "image/webp",
                "heic": "image/heic"
            }
            content_type = content_type_map.get(file_extension.lower(), "image/jpeg")
            
            # Upload file
            blob.upload_from_string(
                file_content,
                content_type=content_type
            )
            
            # Generate signed URL valid for 1 year (for accountant access)
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(days=365),
                method="GET"
            )
            
            logger.info(f"Uploaded receipt to GCS: {filename}")
            return signed_url
            
        except Exception as e:
            logger.error(f"GCS upload failed: {str(e)}")
            return None
    
    async def delete_receipt(self, file_path: str) -> bool:
        """
        Delete a receipt image from GCS.
        
        Args:
            file_path: Path to the file in storage or signed URL
            
        Returns:
            True if deleted, False otherwise
        """
        if not self.client:
            return False
        
        try:
            bucket = self.client.bucket(self.bucket_name)
            
            # Extract blob path from signed URL if needed
            if file_path.startswith("https://"):
                # Parse the path from the signed URL
                # Format: https://storage.googleapis.com/bucket/path?signature...
                import urllib.parse
                parsed = urllib.parse.urlparse(file_path)
                path_parts = parsed.path.split(f"/{self.bucket_name}/")
                if len(path_parts) > 1:
                    file_path = path_parts[1]
                else:
                    # Try alternative format: /bucket/path
                    file_path = parsed.path.lstrip("/")
                    if file_path.startswith(f"{self.bucket_name}/"):
                        file_path = file_path[len(self.bucket_name) + 1:]
            
            blob = bucket.blob(file_path)
            blob.delete()
            
            logger.info(f"Deleted receipt from GCS: {file_path}")
            return True
            
        except NotFound:
            logger.warning(f"File not found in GCS: {file_path}")
            return True  # Consider it deleted if not found
            
        except Exception as e:
            logger.error(f"GCS delete failed: {str(e)}")
            return False
    
    async def get_signed_url(self, file_path: str, expires_in_hours: int = 24) -> Optional[str]:
        """
        Get a new signed URL for a file.
        
        Args:
            file_path: Path to the file in storage
            expires_in_hours: URL expiration time in hours
            
        Returns:
            Signed URL or None
        """
        if not self.client:
            return None
        
        try:
            bucket = self.client.bucket(self.bucket_name)
            blob = bucket.blob(file_path)
            
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(hours=expires_in_hours),
                method="GET"
            )
            
            return signed_url
            
        except Exception as e:
            logger.error(f"Failed to get signed URL: {str(e)}")
            return None
    
    def get_public_url(self, file_path: str) -> str:
        """
        Get the public URL for a file (if bucket is public).
        
        Args:
            file_path: Path to the file in storage
            
        Returns:
            Public URL string
        """
        return f"https://storage.googleapis.com/{self.bucket_name}/{file_path}"


# Lazy initialization - service will be created on first use
# This ensures Google credentials are set up before service initialization
_storage_service_instance = None

def get_storage_service() -> StorageService:
    """Get or create Storage service instance (lazy initialization)."""
    global _storage_service_instance
    if _storage_service_instance is None:
        _storage_service_instance = StorageService()
    return _storage_service_instance

# For backward compatibility - use a class that acts like the service
class StorageServiceProxy:
    """Proxy class that lazily initializes StorageService on first access."""
    def __getattr__(self, name):
        return getattr(get_storage_service(), name)

storage_service = StorageServiceProxy()
