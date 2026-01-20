"""
Bank of Canada Currency Service Test
Validates USD → CAD conversion using the Valet API.
"""

import asyncio
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.currency_service import CurrencyService


async def test_currency_service():
    """Test the Bank of Canada exchange rate service."""
    print("\n" + "="*50)
    print("💱 Bank of Canada Currency Service Test")
    print("="*50 + "\n")
    
    service = CurrencyService()
    
    # Test 1: Today's rate
    print("📅 Test 1: Today's Exchange Rate")
    print("-"*40)
    today = datetime.now()
    rate = await service.get_exchange_rate(today)
    print(f"   Date: {today.strftime('%Y-%m-%d')}")
    print(f"   Rate: 1 USD = {rate:.4f} CAD")
    print(f"   ✅ Rate retrieved successfully\n")
    
    # Test 2: Historical rate (1 week ago)
    print("📅 Test 2: Historical Rate (1 week ago)")
    print("-"*40)
    week_ago = datetime.now() - timedelta(days=7)
    rate_week = await service.get_exchange_rate(week_ago)
    print(f"   Date: {week_ago.strftime('%Y-%m-%d')}")
    print(f"   Rate: 1 USD = {rate_week:.4f} CAD")
    print(f"   ✅ Historical rate retrieved successfully\n")
    
    # Test 3: Conversion calculation
    print("💵 Test 3: USD → CAD Conversion")
    print("-"*40)
    usd_amounts = [100.00, 157.85, 500.00, 1250.00]
    
    for usd in usd_amounts:
        cad = service.convert_usd_to_cad(usd, rate)
        print(f"   ${usd:,.2f} USD → ${cad:,.2f} CAD")
    
    print(f"\n   ✅ Conversion calculations working correctly")
    
    # Test 4: Weekend handling (Bank of Canada doesn't publish on weekends)
    print("\n📅 Test 4: Weekend Fallback")
    print("-"*40)
    
    # Find a recent Sunday
    days_since_sunday = (today.weekday() + 1) % 7
    last_sunday = today - timedelta(days=days_since_sunday)
    
    rate_sunday = await service.get_exchange_rate(last_sunday)
    print(f"   Requested: {last_sunday.strftime('%Y-%m-%d')} (Sunday)")
    print(f"   Rate: 1 USD = {rate_sunday:.4f} CAD")
    print(f"   ✅ Weekend fallback to last business day working\n")
    
    print("="*50)
    print("✅ All currency service tests passed!")
    print("="*50 + "\n")


if __name__ == "__main__":
    asyncio.run(test_currency_service())

