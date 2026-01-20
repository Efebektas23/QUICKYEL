"""
QuickYel Pipeline Test Suite
Tests the complete Google-Native workflow as per the Final Implementation Brief.

Test Checklist:
1. US Receipt Test - Detect USD, skip tax, apply Bank of Canada rate
2. Canadian Receipt Test - Detect CAD, separate GST/HST
3. Categorization Test - Map restaurant to "meals_entertainment"
4. Card Ownership Test - Match card_last_4 to user's defined cards
"""

import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.gemini_service import GeminiService
from services.currency_service import CurrencyService
from datetime import datetime


# Sample receipt texts for testing
US_GAS_RECEIPT = """
LOVE'S TRAVEL STOP #451
2341 INTERSTATE HWY 35
DENTON, TX 76207
(940) 382-1234

DATE: 12/15/2025  TIME: 14:32

PUMP #7
DIESEL         42.156 GAL
@ $3.459/GAL
              $145.82

SUBTOTAL      $145.82
SALES TAX      $12.03
TOTAL         $157.85

VISA ************4521
AUTH: 847291

THANK YOU FOR STOPPING!
"""

CANADIAN_GAS_RECEIPT = """
PETRO-CANADA
1450 HIGHWAY 401 E
TORONTO, ON M1P 4E5
(416) 555-0123

RECEIPT #: 78432
DATE: 2025-12-16  10:45

PUMP 3
DIESEL CLEAR   127.45 L
@ $1.679/L
              $213.94

SUBTOTAL      $213.94
HST (13%)      $27.81
TOTAL         $241.75

MASTERCARD ****9876
APPROVED

MERCI / THANK YOU
"""

RESTAURANT_RECEIPT = """
TIM HORTONS #4521
789 QUEEN ST WEST
TORONTO, ON M5V 2M4

ORDER #: 847
DATE: 2025-12-16

2x Large Double Double    $4.38
1x BLT Sandwich           $7.49
1x Boston Cream Donut     $1.99

SUBTOTAL                 $13.86
HST                       $1.80
TOTAL                    $15.66

VISA ****1234
APPROVED

HAVE A GREAT DAY!
"""

US_HOTEL_RECEIPT = """
HAMPTON INN & SUITES
4521 HIGHWAY 75
MCKINNEY, TX 75070
Phone: (972) 555-8900

Guest: JOHN SMITH
Check-in: 12/14/2025
Check-out: 12/15/2025

Room 412 - 1 King Bed
Room Rate               $129.00
State Tax                $10.71
Local Tax                 $7.74

TOTAL                   $147.45

AMEX ****3456

Thank you for staying with us!
"""

SCALE_RECEIPT = """
CAT SCALE
WEIGHT TICKET

Location: I-80 Exit 179
Lamar, PA 16848

Date: 12/16/2025  08:23

Truck ID: ON-4521
Steer:   11,240 lbs
Drive:   33,450 lbs  
Trailer: 31,280 lbs
GROSS:   75,970 lbs

FEE: $14.50

VISA ****7890
"""


class PipelineTest:
    """Test harness for the QuickYel pipeline."""
    
    def __init__(self):
        self.gemini = GeminiService()
        self.currency = CurrencyService()
        self.results = []
    
    async def run_all_tests(self):
        """Run all pipeline tests."""
        print("\n" + "="*60)
        print("🧪 QuickYel Pipeline Test Suite")
        print("   Google Native Stack - Project: muhtar-5ab9b")
        print("="*60 + "\n")
        
        await self.test_us_receipt()
        await self.test_canadian_receipt()
        await self.test_categorization()
        await self.test_us_hotel()
        await self.test_scale_receipt()
        
        self.print_summary()
    
    async def test_us_receipt(self):
        """Test 1: US Gas Station Receipt (Love's Travel Stop)"""
        print("📋 TEST 1: US Gas Station Receipt")
        print("-" * 40)
        
        result = await self.gemini.parse_receipt(US_GAS_RECEIPT)
        
        checks = {
            "Vendor detected": result.vendor_name and "love" in result.vendor_name.lower(),
            "Jurisdiction = USA": result.jurisdiction == "usa",
            "Category = Fuel": result.category == "fuel",
            "Tax = 0 (US tax not recoverable)": result.tax_amount == 0,
            "Amount extracted": result.total_amount is not None,
            "Card last 4 extracted": result.card_last_4 == "4521",
        }
        
        # Test currency conversion
        if result.total_amount:
            rate = await self.currency.get_exchange_rate(datetime.now())
            cad_amount = self.currency.convert_usd_to_cad(result.total_amount, rate)
            checks["CAD conversion works"] = cad_amount > result.total_amount
            print(f"   💱 USD ${result.total_amount:.2f} → CAD ${cad_amount:.2f} (rate: {rate:.4f})")
        
        self._print_result(result, checks)
        self.results.append(("US Receipt", all(checks.values())))
    
    async def test_canadian_receipt(self):
        """Test 2: Canadian Gas Station Receipt (Petro-Canada)"""
        print("\n📋 TEST 2: Canadian Gas Station Receipt")
        print("-" * 40)
        
        result = await self.gemini.parse_receipt(CANADIAN_GAS_RECEIPT)
        
        checks = {
            "Vendor detected": result.vendor_name and "petro" in result.vendor_name.lower(),
            "Jurisdiction = Canada": result.jurisdiction == "canada",
            "Category = Fuel": result.category == "fuel",
            "HST extracted (> 0)": result.tax_amount > 0,
            "Amount extracted": result.total_amount is not None,
            "Card last 4 extracted": result.card_last_4 == "9876",
        }
        
        if result.tax_amount > 0:
            print(f"   🧾 HST Recovered: ${result.tax_amount:.2f} (ITC eligible)")
        
        self._print_result(result, checks)
        self.results.append(("Canadian Receipt", all(checks.values())))
    
    async def test_categorization(self):
        """Test 3: Restaurant Receipt (Tim Hortons) → Meals Category"""
        print("\n📋 TEST 3: Restaurant Receipt → Meals Category")
        print("-" * 40)
        
        result = await self.gemini.parse_receipt(RESTAURANT_RECEIPT)
        
        checks = {
            "Vendor detected": result.vendor_name and "tim" in result.vendor_name.lower(),
            "Jurisdiction = Canada": result.jurisdiction == "canada",
            "Category = Meals & Entertainment": result.category == "meals_entertainment",
            "HST extracted": result.tax_amount > 0,
            "Amount extracted": result.total_amount is not None,
        }
        
        print(f"   🍽️ Note: Meals are 50% deductible for CRA purposes")
        
        self._print_result(result, checks)
        self.results.append(("Meals Categorization", all(checks.values())))
    
    async def test_us_hotel(self):
        """Test 4: US Hotel Receipt → Travel Category"""
        print("\n📋 TEST 4: US Hotel Receipt → Travel Category")
        print("-" * 40)
        
        result = await self.gemini.parse_receipt(US_HOTEL_RECEIPT)
        
        checks = {
            "Vendor detected": result.vendor_name and "hampton" in result.vendor_name.lower(),
            "Jurisdiction = USA": result.jurisdiction == "usa",
            "Category = Travel/Lodging": result.category == "travel_lodging",
            "Tax = 0 (US tax)": result.tax_amount == 0,
            "Amount extracted": result.total_amount is not None,
            "Card last 4 extracted": result.card_last_4 == "3456",
        }
        
        self._print_result(result, checks)
        self.results.append(("US Hotel", all(checks.values())))
    
    async def test_scale_receipt(self):
        """Test 5: CAT Scale Receipt → Tolls/Scales Category"""
        print("\n📋 TEST 5: CAT Scale Receipt → Tolls Category")
        print("-" * 40)
        
        result = await self.gemini.parse_receipt(SCALE_RECEIPT)
        
        checks = {
            "Vendor detected": "cat" in (result.vendor_name or "").lower() or "scale" in (result.vendor_name or "").lower(),
            "Category = Tolls/Scales": result.category == "tolls_scales",
            "Amount extracted": result.total_amount is not None,
            "Card last 4 extracted": result.card_last_4 == "7890",
        }
        
        self._print_result(result, checks)
        self.results.append(("Scale Receipt", all(checks.values())))
    
    def _print_result(self, result, checks):
        """Print parsed result and check status."""
        print(f"\n   Parsed Data:")
        print(f"   • Vendor: {result.vendor_name}")
        print(f"   • Date: {result.transaction_date}")
        print(f"   • Amount: ${result.total_amount:.2f}" if result.total_amount else "   • Amount: None")
        print(f"   • Jurisdiction: {result.jurisdiction}")
        print(f"   • Category: {result.category}")
        print(f"   • Tax: ${result.tax_amount:.2f}")
        print(f"   • Card: ****{result.card_last_4}" if result.card_last_4 else "   • Card: None")
        print(f"   • Confidence: {result.confidence:.0%}")
        
        print(f"\n   Validation:")
        for check, passed in checks.items():
            status = "✅" if passed else "❌"
            print(f"   {status} {check}")
    
    def print_summary(self):
        """Print test summary."""
        print("\n" + "="*60)
        print("📊 TEST SUMMARY")
        print("="*60)
        
        passed = sum(1 for _, p in self.results if p)
        total = len(self.results)
        
        for name, result in self.results:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"   {status} - {name}")
        
        print("-"*40)
        print(f"   Total: {passed}/{total} tests passed")
        
        if passed == total:
            print("\n🎉 All tests passed! Pipeline is ready for production.")
        else:
            print("\n⚠️ Some tests failed. Please review the output above.")
        
        print("="*60 + "\n")


async def main():
    """Run the test suite."""
    tester = PipelineTest()
    await tester.run_all_tests()


if __name__ == "__main__":
    asyncio.run(main())

