"""Database configuration and session management."""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings
import os

# Use SQLite for easy testing (no PostgreSQL required)
# For production, set DATABASE_URL to your PostgreSQL connection string
if "postgresql" in settings.database_url:
    # SQLite fallback for development/testing
    db_path = os.path.join(os.path.dirname(__file__), "quickyel.db")
    DATABASE_URL = f"sqlite+aiosqlite:///{db_path}"
else:
    DATABASE_URL = settings.database_url

# Database connection pool settings for Railway
# pool_pre_ping: Checks if connection is alive before using (handles Railway sleep mode)
# pool_size: Number of connections to maintain
# max_overflow: Additional connections beyond pool_size
# pool_timeout: Seconds to wait before giving up on getting a connection
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

