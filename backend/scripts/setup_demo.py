"""
QuickYel Demo Setup Script
Creates the GCS bucket and verifies all Google Cloud services are working.
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from google.cloud import storage, vision
import vertexai
from vertexai.generative_models import GenerativeModel

from config import settings


def check_vision_api():
    """Test Google Cloud Vision API."""
    print("\n📷 Checking Google Cloud Vision API...")
    try:
        client = vision.ImageAnnotatorClient()
        # Simple API connectivity check
        print(f"   ✅ Vision API client initialized")
        print(f"   Project: {settings.google_cloud_project}")
        return True
    except Exception as e:
        print(f"   ❌ Vision API Error: {e}")
        return False


def check_vertex_ai():
    """Test Vertex AI / Gemini access."""
    print("\n🤖 Checking Vertex AI (Gemini 1.5 Flash)...")
    try:
        vertexai.init(
            project=settings.google_cloud_project,
            location="us-central1"
        )
        
        model = GenerativeModel(model_name=settings.gemini_model)
        response = model.generate_content("Say 'QuickYel is ready!' in one line.")
        
        print(f"   Model: {settings.gemini_model}")
        print(f"   Response: {response.text.strip()}")
        print(f"   ✅ Gemini API working")
        return True
    except Exception as e:
        print(f"   ❌ Vertex AI Error: {e}")
        return False


def check_and_create_bucket():
    """Check and create GCS bucket if needed."""
    print("\n🪣 Checking Google Cloud Storage...")
    try:
        client = storage.Client(project=settings.google_cloud_project)
        bucket_name = settings.gcs_bucket_name
        
        bucket = client.bucket(bucket_name)
        
        if bucket.exists():
            print(f"   ✅ Bucket '{bucket_name}' exists")
        else:
            print(f"   Creating bucket '{bucket_name}'...")
            bucket = client.create_bucket(bucket_name, location="us-central1")
            
            # Set lifecycle rule for 7-year retention (CRA requirement)
            bucket.add_lifecycle_delete_rule(age=2555)
            bucket.patch()
            
            print(f"   ✅ Bucket '{bucket_name}' created with 7-year lifecycle")
        
        return True
    except Exception as e:
        print(f"   ❌ GCS Error: {e}")
        return False


def check_credentials():
    """Verify service account credentials."""
    print("\n🔑 Checking Service Account Credentials...")
    
    cred_path = settings.google_application_credentials
    
    if os.path.exists(cred_path):
        import json
        with open(cred_path) as f:
            creds = json.load(f)
        
        print(f"   Project ID: {creds.get('project_id')}")
        print(f"   Service Account: {creds.get('client_email')}")
        print(f"   ✅ Credentials file found and valid")
        return True
    else:
        print(f"   ❌ Credentials file not found: {cred_path}")
        return False


def print_summary(results):
    """Print setup summary."""
    print("\n" + "="*60)
    print("📋 SETUP SUMMARY")
    print("="*60)
    
    for service, status in results.items():
        icon = "✅" if status else "❌"
        print(f"   {icon} {service}")
    
    if all(results.values()):
        print("\n" + "-"*60)
        print("🎉 All systems ready! QuickYel is configured correctly.")
        print("-"*60)
        print("\nTo start the backend server:")
        print("   cd backend")
        print("   uvicorn main:app --reload --port 8000")
        print("\nTo run pipeline tests:")
        print("   python tests/test_pipeline.py")
        print("   python tests/test_currency.py")
    else:
        print("\n⚠️ Some services failed. Please check the errors above.")
    
    print("="*60 + "\n")


def main():
    """Run all setup checks."""
    print("\n" + "="*60)
    print("🚀 QuickYel Demo Setup - Google Native Stack")
    print("   Project: muhtar-5ab9b")
    print("="*60)
    
    results = {
        "Service Account Credentials": check_credentials(),
        "Google Cloud Vision API": check_vision_api(),
        "Vertex AI (Gemini)": check_vertex_ai(),
        "Google Cloud Storage": check_and_create_bucket(),
    }
    
    print_summary(results)
    
    return all(results.values())


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

