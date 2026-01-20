"""Database configuration and session management."""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings
import os
import logging

logger = logging.getLogger(__name__)

# Parse DATABASE_URL and convert to SQLAlchemy async format
# Railway provides: postgresql://user:pass@host:port/dbname
# SQLAlchemy async needs: postgresql+asyncpg://user:pass@host:port/dbname
database_url = settings.database_url

# Check if PostgreSQL URL is provided
if database_url and "postgresql://" in database_url:
    # Convert postgresql:// to postgresql+asyncpg:// for async SQLAlchemy
    if "postgresql+asyncpg://" not in database_url:
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    DATABASE_URL = database_url
    logger.info("Using PostgreSQL database (asyncpg)")
elif database_url and "postgresql+asyncpg://" in database_url:
    # Already in correct format
    DATABASE_URL = database_url
    logger.info("Using PostgreSQL database (asyncpg) - already formatted")
else:
    # Fallback to SQLite for local development/testing
    db_path = os.path.join(os.path.dirname(__file__), "quickyel.db")
    DATABASE_URL = f"sqlite+aiosqlite:///{db_path}"
    logger.warning(f"Using SQLite fallback database: {db_path}")
    logger.warning("⚠️ SQLite is for development only! Use PostgreSQL in production.")

# Database connection pool settings for Railway
# pool_pre_ping: Checks if connection is alive before using (handles Railway sleep mode)
# pool_size: Number of connections to maintain
# max_overflow: Additional connections beyond pool_size
# pool_timeout: Seconds to wait before giving up on getting a connection

# Different pool settings for PostgreSQL vs SQLite
if "sqlite" in DATABASE_URL:
    # SQLite doesn't support connection pooling the same way
    engine = create_async_engine(
        DATABASE_URL,
        echo=settings.debug,
        future=True,
        connect_args={"check_same_thread": False}  # SQLite specific
    )
    logger.info("SQLite engine created (no connection pooling)")
else:
    # PostgreSQL connection pool settings
    engine = create_async_engine(
        DATABASE_URL,
        echo=settings.debug,
        future=True,
        pool_pre_ping=True,  # Reconnect if connection is dead (important for Railway)
        pool_size=5,  # Maintain 5 connections
        max_overflow=10,  # Allow up to 10 additional connections
        pool_timeout=30,  # Wait 30 seconds for a connection
        pool_recycle=3600,  # Recycle connections after 1 hour
    )
    logger.info("PostgreSQL engine created with connection pooling")

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """Dependency to get database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

