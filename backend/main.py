"""
QuickYel - Expense Automation Platform
Main FastAPI Application - Google Native Stack
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from config import settings
from database import init_db
from routers import auth, expenses, users, export, cards, process, revenue

# Configure logging
logging.basicConfig(
    level=logging.INFO if settings.debug else logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    logger.info("Starting QuickYel API - Google Native Stack")
    logger.info(f"Project: {settings.google_cloud_project}")
    logger.info(f"GCS Bucket: {settings.gcs_bucket_name}")
    logger.info(f"Gemini API: {'Configured' if settings.gemini_api_key else 'NOT CONFIGURED'}")
    logger.info(f"Vision Monthly Limit: {settings.vision_monthly_limit}")
    
    await init_db()
    logger.info("Database initialized")
    
    yield
    
    # Shutdown
    logger.info("Shutting down QuickYel API")


app = FastAPI(
    title="QuickYel API",
    description="""
    Expense Automation Platform for Canadian Logistics
    
    **Google Native Stack:**
    - Google Cloud Vision (OCR)
    - Google Gemini 1.5 Flash (AI Parser)
    - Google Cloud Storage (Receipt Images)
    - Bank of Canada API (Currency Conversion)
    """,
    version="2.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(expenses.router, prefix="/api/expenses", tags=["Expenses"])
app.include_router(cards.router, prefix="/api/cards", tags=["Cards"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])
app.include_router(process.router, prefix="/api/process-receipt", tags=["Process Receipt"])
app.include_router(revenue.router, prefix="/api/process-rate-confirmation", tags=["Process Rate Confirmation"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "QuickYel API - Google Native Stack",
        "version": "2.0.0",
        "docs": "/docs",
        "stack": {
            "ocr": "Google Cloud Vision",
            "ai": "Gemini 1.5 Flash",
            "storage": "Google Cloud Storage",
            "currency": "Bank of Canada API"
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "project": settings.google_cloud_project
    }
