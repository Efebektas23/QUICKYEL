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

# Railway Internal URL Detection
# Railway provides both internal and public URLs
# Internal URLs are required for service-to-service communication
# Internal URL format: postgresql://...@containers-XXX.railway.app:5432/...
# Public URL format: postgresql://...@public.containers-XXX.railway.app:5432/...
if database_url and "public.containers" in database_url:
    logger.warning("⚠️ WARNING: Using PUBLIC database URL. This may cause connection issues!")
    logger.warning("⚠️ Please use INTERNAL URL from PostgreSQL service Variables tab.")
    logger.warning("⚠️ Internal URL format: postgresql://...@containers-XXX.railway.app:5432/...")

# Check if PostgreSQL URL is provided
if database_url and "postgresql://" in database_url:
    # Convert postgresql:// to postgresql+asyncpg:// for async SQLAlchemy
    if "postgresql+asyncpg://" not in database_url:
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # Railway PostgreSQL requires SSL connection
    # Add SSL parameter if not already present
    if "?" not in database_url and "ssl" not in database_url.lower():
        # Check if Railway (internal connection) - Railway uses self-signed certs
        if "railway.app" in database_url or "railway.internal" in database_url:
            # Railway internal connections may not require SSL verification
            database_url = f"{database_url}?ssl=prefer"
        else:
            # External PostgreSQL connections should use SSL
            database_url = f"{database_url}?ssl=require"
    
    DATABASE_URL = database_url
    logger.info("Using PostgreSQL database (asyncpg) with SSL")
elif database_url and "postgresql+asyncpg://" in database_url:
    # Already in correct format, but check SSL
    if "?" not in database_url and "ssl" not in database_url.lower():
        if "railway.app" in database_url or "railway.internal" in database_url:
            database_url = f"{database_url}?ssl=prefer"
        else:
            database_url = f"{database_url}?ssl=require"
    DATABASE_URL = database_url
    logger.info("Using PostgreSQL database (asyncpg) - already formatted with SSL")
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
    # Railway PostgreSQL connections may need SSL configuration
    
    # Get SSL configuration - ensure it's always a dict, never None
    def get_ssl_config() -> dict:
        """Get SSL configuration for PostgreSQL connection. Always returns a dict."""
        # Always start with empty dict - never None
        ssl_config = {}
        
        try:
            if "railway" in DATABASE_URL.lower():
                # Railway uses self-signed certificates, disable SSL verification for internal connections
                # asyncpg SSL mode: 'disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'
                ssl_config["ssl"] = "prefer"  # Prefer SSL but don't require strict verification for Railway
                logger.info("Railway PostgreSQL detected - using SSL prefer mode")
            elif "ssl" in DATABASE_URL.lower() or "sslmode" in DATABASE_URL.lower():
                # URL already contains SSL parameters, let asyncpg handle it
                logger.info("SSL parameters detected in DATABASE_URL")
            else:
                # No SSL configuration needed, return empty dict
                logger.info("No SSL configuration required")
        except Exception as e:
            logger.warning(f"Error determining SSL config: {e}, using empty dict")
            ssl_config = {}
        
        # Defensive: Always return a dict, never None
        # Use multiple safety checks
        if ssl_config is None:
            ssl_config = {}
        if not isinstance(ssl_config, dict):
            ssl_config = {}
        
        return ssl_config
    
    # Get SSL config with multiple safety checks
    connect_args = get_ssl_config() or {}  # First safety: or {}
    
    # Additional defensive checks
    if connect_args is None:
        connect_args = {}
    if not isinstance(connect_args, dict):
        logger.error(f"connect_args is not a dict: {type(connect_args)}, converting to empty dict")
        connect_args = {}
    
    # Prepare engine arguments
    engine_kwargs = {
        "url": DATABASE_URL,
        "echo": settings.debug,
        "future": True,
        "pool_pre_ping": True,  # Reconnect if connection is dead (important for Railway)
        "pool_size": 5,  # Maintain 5 connections
        "max_overflow": 10,  # Allow up to 10 additional connections
        "pool_timeout": 30,  # Wait 30 seconds for a connection
        "pool_recycle": 3600,  # Recycle connections after 1 hour
    }
    
    # Only add connect_args if it's a non-empty dict
    # SQLAlchemy accepts empty dict, but it's cleaner to omit if empty
    if connect_args and isinstance(connect_args, dict) and len(connect_args) > 0:
        engine_kwargs["connect_args"] = connect_args
        logger.info(f"Adding connect_args to engine: {connect_args}")
    else:
        logger.info("No connect_args needed, using default connection settings")
    
    # Create engine with guaranteed safe arguments
    engine = create_async_engine(**engine_kwargs)
    
    ssl_mode = connect_args.get("ssl", "default") if isinstance(connect_args, dict) else "default"
    logger.info(f"PostgreSQL engine created with connection pooling (SSL: {ssl_mode})")

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

