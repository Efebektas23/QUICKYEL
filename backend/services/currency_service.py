"""Bank of Canada Currency Exchange Service."""

import httpx
from datetime import datetime, timedelta
from typing import Optional
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import ExchangeRateCache

logger = logging.getLogger(__name__)


class CurrencyService:
    """Service for fetching USD/CAD exchange rates from Bank of Canada."""
    
    # Bank of Canada Valet API endpoint
    BASE_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD"
    
    # Fallback rate if API fails
    FALLBACK_RATE = 1.35
    
    async def get_exchange_rate(
        self, 
        date: datetime, 
        db: Optional[AsyncSession] = None
    ) -> float:
        """
        Get USD to CAD exchange rate for a specific date.
        
        Args:
            date: The date for the exchange rate
            db: Optional database session for caching
            
        Returns:
            Exchange rate (1 USD = X CAD)
        """
        # Check cache first if db session provided
        if db:
            cached_rate = await self._get_cached_rate(db, date)
            if cached_rate:
                logger.info(f"Using cached rate for {date.date()}: {cached_rate}")
                return cached_rate
        
        # Fetch from Bank of Canada API
        rate = await self._fetch_rate_from_boc(date)
        
        # Cache the rate if db session provided
        if db and rate:
            await self._cache_rate(db, date, rate)
        
        return rate or self.FALLBACK_RATE
    
    async def _fetch_rate_from_boc(self, date: datetime) -> Optional[float]:
        """
        Fetch exchange rate from Bank of Canada Valet API.
        
        Args:
            date: The date for the exchange rate
            
        Returns:
            Exchange rate or None if failed
        """
        try:
            # Format date for API
            date_str = date.strftime("%Y-%m-%d")
            
            # Bank of Canada may not have rates for weekends/holidays
            # Try the requested date first, then look back up to 5 days
            for days_back in range(6):
                check_date = date - timedelta(days=days_back)
                check_date_str = check_date.strftime("%Y-%m-%d")
                
                params = {
                    "start_date": check_date_str,
                    "end_date": check_date_str
                }
                
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        self.BASE_URL,
                        params=params,
                        timeout=10.0
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        observations = data.get("observations", [])
                        
                        if observations:
                            rate_data = observations[0].get("FXUSDCAD", {})
                            rate = float(rate_data.get("v", 0))
                            
                            if rate > 0:
                                logger.info(f"Fetched BOC rate for {check_date_str}: {rate}")
                                return rate
            
            logger.warning(f"No rate found for date range around {date_str}")
            return None
            
        except Exception as e:
            logger.error(f"Failed to fetch BOC rate: {str(e)}")
            return None
    
    async def _get_cached_rate(self, db: AsyncSession, date: datetime) -> Optional[float]:
        """Get cached exchange rate from database."""
        try:
            # Normalize date to start of day
            date_key = datetime(date.year, date.month, date.day)
            
            result = await db.execute(
                select(ExchangeRateCache).where(
                    ExchangeRateCache.date == date_key
                )
            )
            cached = result.scalar_one_or_none()
            
            return cached.usd_to_cad if cached else None
            
        except Exception as e:
            logger.error(f"Cache lookup failed: {str(e)}")
            return None
    
    async def _cache_rate(self, db: AsyncSession, date: datetime, rate: float):
        """Cache exchange rate in database."""
        try:
            date_key = datetime(date.year, date.month, date.day)
            
            # Check if already cached
            existing = await self._get_cached_rate(db, date)
            if existing:
                return
            
            cache_entry = ExchangeRateCache(
                date=date_key,
                usd_to_cad=rate,
                fetched_at=datetime.utcnow()
            )
            
            db.add(cache_entry)
            await db.commit()
            
            logger.info(f"Cached rate for {date_key.date()}: {rate}")
            
        except Exception as e:
            logger.error(f"Failed to cache rate: {str(e)}")
    
    def convert_usd_to_cad(self, usd_amount: float, rate: float) -> float:
        """
        Convert USD amount to CAD.
        
        Args:
            usd_amount: Amount in USD
            rate: Exchange rate (1 USD = X CAD)
            
        Returns:
            Amount in CAD
        """
        return round(usd_amount * rate, 2)
    
    async def get_exchange_rate_simple(self, date: datetime) -> float:
        """
        Get USD to CAD exchange rate without database caching.
        For use with Firebase flow.
        """
        rate = await self._fetch_rate_from_boc(date)
        return rate or self.FALLBACK_RATE


# Singleton instance
currency_service = CurrencyService()

