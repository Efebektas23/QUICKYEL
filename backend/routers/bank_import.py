"""Bank CSV Import router - Parse RBC bank statements and categorize transactions."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
import logging
import csv
import io
import json

from config import settings
from services.resilient_ai import ResilientModelFactory

router = APIRouter()
logger = logging.getLogger(__name__)

# Valid expense categories for AI categorization
VALID_CATEGORIES = [
    "fuel", "maintenance_repairs", "insurance", "licenses_dues",
    "tolls_scales", "meals_entertainment", "travel_lodging", "office_admin",
    "factoring_fees", "payroll", "subcontractor", "professional_fees",
    "rent_lease", "loan_interest", "other_expenses", "uncategorized"
]


def _transaction_row_is_usd_account(tx: dict) -> bool:
    """True when the CSV row carries USD amounts (RBC USD column), not CAD."""
    ausd = tx.get("amount_usd")
    acad = tx.get("amount_cad")
    return ausd is not None and ausd != 0 and (acad is None or acad == 0)


def _is_rbc_usd_business_pad_tch_expense(tx: dict) -> bool:
    """RBC USD Business PAD + TCH descriptors = RXO fuel (not TCH Canada lease)."""
    if tx.get("type") != "expense":
        return False
    combo = f'{(tx.get("description1") or "")} {(tx.get("description2") or "")}'.lower()
    return (
        _transaction_row_is_usd_account(tx)
        and "business pad" in combo
        and "tch" in combo
    )


def _is_credit_card_payment_thank_you(desc1: str) -> bool:
    """Card statement credit from paying the balance — not business income."""
    d = (desc1 or "").lower()
    if "thank you" not in d and "merci" not in d:
        return False
    return (
        "payment - thank you" in d
        or "paiement - merci" in d
        or "payment received" in d
    )


# Gemini prompt for bank transaction categorization
BANK_CATEGORIZATION_PROMPT = """You are an expert Canadian accountant for a trucking/logistics company (BACKTAS GLOBAL LOGISTICS ULC).
You need to categorize bank transactions from RBC business accounts: **chequing** (CAD/USD) and **credit card** exports.
The row may have **CAD$ only**, **USD$ only** (native US card or USD chequing), or both — use the non-empty amount column(s).

COMPANY CONTEXT:
- Trucking/logistics company operating in Canada and USA
- Uses J D Factors as factoring company for freight invoices (both CAD and USD accounts)
- Has ICBC truck/trailer insurance policies
- Pays employees via Direct Deposits and e-Transfers
- Common vendors: ICBC (insurance), CAFO Inc (insurance), J D Factors (factoring)
- Has "TCH CANADA" / "Business PAD" on the **CAD** account = truck/equipment **lease** (rent_lease) to TCH Canada
- **RBC USD account (07760-4001350)**: debits labeled **Business PAD** with **TCH** (and often broker context) are **RXO fuel card / fuel program** charges — MUST use category **"fuel"**, vendor **"RXO"**, NOT rent_lease
- Company has two RBC accounts: one CAD (07760-1001270) and one USD (07760-4001350)
- **US RBC Visa/Mastercard (USD native amounts)**: operating expenses in the USA (tolls, permits, fuel, lumpers, software, etc.) — still use the same expense categories; **do not** treat USD as CAD.
- Owner names: "Yeliz Bektas", "Ozan Bektas"

⚠️ CRITICAL - MUST CLASSIFY THESE AS "transfer" (NOT income, NOT expense):
   - "Funds transfer" (ANY direction, positive or negative) = ALWAYS "transfer"
   - "PAYMENT - THANK YOU / PAIEMENT - MERCI" = Credit card payment = ALWAYS "transfer"
   - "PAYMENT RECEIVED -- THANK YOU" (US card) = paying down the card = ALWAYS "transfer" (same as above — NOT income)
   - "Online Banking transfer" = ALWAYS "transfer"
   - "Credit Memo" about currency exchange or internal = ALWAYS "transfer"
   - e-Transfer from owner/family (Yeliz Bektas, Ozan Bektas) = ALWAYS "transfer"
   - Any positive amount at a retail store (refund/return) = "transfer"

⚠️ CRITICAL - MUST CLASSIFY THESE AS "tax_refund" (NOT income, NOT expense):
   - "GST" or "HST" in description = Government tax refund = ALWAYS "tax_refund"
   - "RECEIVER GENERAL" or "REC GEN" in description (positive amount) = CRA tax refund = ALWAYS "tax_refund"
   - "FED GOVT" in description (positive amount) = Federal government refund = ALWAYS "tax_refund"
   - "CANADA REVENUE" or "CRA" in description (positive amount) = Tax refund = ALWAYS "tax_refund"
   - Any government deposit that is a refund of taxes previously paid = ALWAYS "tax_refund"
   - Tax refunds are NOT business revenue - they are returns of overpaid tax

⚠️ CRITICAL - MUST CLASSIFY THESE AS "owner_draw" (NOT expense):
   - "Cash withdrawal" = ALWAYS "owner_draw"
   - "ATM withdrawal" = ALWAYS "owner_draw"
   - "Debit Memo" + "OWNER DRAW" = ALWAYS "owner_draw"
   - e-Transfer SENT to owner/family (Yeliz Bektas, Ozan Bektas) = ALWAYS "owner_draw"

TRANSACTION CLASSIFICATION RULES:

1. INCOME (positive amounts) - classify as "income" ONLY for real business revenue:
   - "Misc Payment" + "J D FACTORS" = Factoring payment received → "income"
   - "Deposit" = Cash or cheque deposit → "income" (unless description says otherwise)
   - "CASH BACK REWARD" = "income" (bank reward)
   - ⚠️ NEVER classify "Funds transfer", "PAYMENT - THANK YOU", "PAYMENT RECEIVED -- THANK YOU", "Credit Memo" as income!
   - ⚠️ NEVER classify GST/HST refunds, RECEIVER GENERAL, CRA deposits as income! Use "tax_refund"!

2. EXPENSES (negative amounts) - classify with one of these categories:
   - "insurance": ICBC, CAFO Inc, any insurance premium
   - "payroll": "Direct Deposits (PDS)", "PAY EMP-VENDOR", salary/wage payments
   - "office_admin": "Monthly fee", "Electronic transaction fee", "Bill Payment PAY-FILE FEES", "INTERAC e-Transfer fee", "Service fee", "Items on deposit fee", "In branch cash deposited fee", "Online Banking wire fee", bank charges; **US card**: OPENAI, CURSOR, SaaS; FLEETSMARTS-style fleet software
   - "factoring_fees": Any J D Factors fees or charges (NOT incoming payments)
   - "other_expenses": "COMMERCIAL TAXES", "EMPTX", tax remittances; lumper/unload (CP * TRUCK UNLOAD, LINEAGE, KEHE, etc.), court/civil fees, US state tax portals (NM, CT) when not GST/HST
   - "rent_lease": **CAD account only** — "Business PAD" + "TCH CANADA" = truck/equipment lease to TCH Canada (recurring lease — NOT a dealer vehicle/trailer purchase)
   - ⚠️ Vehicle or trailer **purchase / loan principal** payments to **auto dealers**, "OpenRoad", "Honda", "Toyota", "Quest Trailer", trailer vendors, etc. are **capital assets** — use "rent_lease" ONLY for true operating leases; for purchases use the best expense category tag for audit BUT set "is_asset_candidate": true and prefer "other_expenses" or "maintenance_repairs" over "rent_lease" if unsure (user will reclassify to Asset in app)
   - "fuel": Gas stations (PETRO-CANADA, SHELL, CHEVRON, FLYING J, etc.); **USD account** — "Business PAD" + "TCH" = **RXO fuel** (NOT rent_lease)
   - "subcontractor": e-Transfer to known contractors/drivers
   - "professional_fees": Payments to accountants, lawyers, consultants
   - "loan_interest": Loan payments, "PURCHASE INTEREST", "INTEREST CHARGE-PURCHASE" (credit card interest)
   - "maintenance_repairs": Vehicle repairs, parts
   - "licenses_dues": Government permits, licenses; **US**: UNIFIED CARRIER REGISTRATION (UCR), state permit portals
   - "tolls_scales": Tolls, bridge fees, scale fees; **US**: DTOPS, PREPASS, EZPASS / E-ZPass (incl. Bank of America debits), CBP border fees, CAT SCALE, ODOT tolls
   - "meals_entertainment": Restaurants, food, DENNY'S, TIM HORTONS
   - "travel_lodging": Hotels, motels
   - "uncategorized": Cannot determine category
   - ⚠️ NEVER classify "Funds transfer", "Cash withdrawal" as expense!

3. TRANSFERS/NON-BUSINESS (MUST flag correctly):
   - "Funds transfer" (positive OR negative) = ALWAYS "transfer"
   - "PAYMENT - THANK YOU / PAIEMENT - MERCI" or "PAYMENT RECEIVED -- THANK YOU" = ALWAYS "transfer" (credit card payment)
   - "Online Banking transfer" = ALWAYS "transfer"
   - "Cash withdrawal" = ALWAYS "owner_draw"
   - "ATM withdrawal" = ALWAYS "owner_draw"
   - "Debit Memo" + "OWNER" = ALWAYS "owner_draw"
   - e-Transfer to/from "Yeliz Bektas" or "Ozan Bektas" = "owner_draw" (sent) or "transfer" (received)

4. PAYMENT SOURCE:
   - "bank_checking" for all direct debits, auto-payments, bill payments
   - "e_transfer" for e-Transfers

5. ASSET DETECTION (CRITICAL for CRA compliance):
   - Vehicle purchases (dealerships, auto sales) > $5,000 → set "is_asset_candidate": true
   - Trailer purchases (dry van, reefer, flatbed) > $5,000 → set "is_asset_candidate": true
   - Heavy equipment purchases > $10,000 → set "is_asset_candidate": true
   - These are capital assets that must be DEPRECIATED, not expensed immediately
   - Still categorize them normally, but add the flag and note "⚡ POTENTIAL ASSET - may need CCA classification"
   - Common keywords: dealer, motors, auto, trailer, equipment, machinery, forklift

RESPOND WITH ONLY a JSON array. Each element should have:
{
  "index": number (0-based row index),
  "type": "expense" | "income" | "transfer" | "owner_draw" | "tax_refund",
  "category": "one of the valid categories or 'income' or 'transfer' or 'owner_draw' or 'tax_refund'",
  "payment_source": "bank_checking" | "e_transfer",
  "vendor_name": "cleaned up vendor/payee name",
  "notes": "brief note about what this transaction is",
  "confidence": number 0.0-1.0,
  "is_asset_candidate": boolean (optional, true only for high-value asset purchases)
}

RESPOND WITH ONLY THE JSON ARRAY (no markdown, no explanation):"""


class BankTransaction(BaseModel):
    """Single parsed bank transaction."""
    index: int
    transaction_date: str
    description1: str
    description2: str
    amount_cad: Optional[float] = None
    amount_usd: Optional[float] = None
    # AI-assigned fields
    type: str = "expense"  # expense, income, transfer, owner_draw, tax_refund
    category: str = "uncategorized"
    payment_source: str = "bank_checking"
    vendor_name: str = ""
    notes: str = ""
    confidence: float = 0.0
    is_asset_candidate: bool = False


class ParseBankCSVRequest(BaseModel):
    """Request body with CSV content."""
    csv_content: str


class ParseBankCSVResponse(BaseModel):
    """Response with parsed and categorized transactions."""
    transactions: List[BankTransaction]
    summary: dict


class BankCategorizationService:
    """Service for parsing and categorizing bank transactions.
    
    Enhanced with resilient AI wrapper:
    - Exponential backoff retry (503/429/500)
    - Model fallback (gemini-2.0-flash → gemini-1.5-flash)
    - Circuit breaker (prevents cascade failures)
    """
    
    def __init__(self):
        try:
            api_key = settings.gemini_api_key
            if not api_key:
                logger.warning("No Gemini API key found. AI categorization disabled.")
                self.model = None
                self.model_factory = None
                return
            
            # Initialize resilient model factory (retry + fallback + circuit breaker)
            self.model_factory = ResilientModelFactory(
                api_key=api_key,
                primary_config={
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "max_output_tokens": 8192,
                }
            )
            
            # Keep self.model for backward compatibility checks
            self.model = self.model_factory.primary_model
            logger.info("Bank categorization service initialized with resilient AI wrapper")
        except Exception as e:
            logger.error(f"Failed to initialize bank categorization service: {str(e)}")
            self.model = None
            self.model_factory = None
    
    def parse_csv(self, csv_content: str) -> List[dict]:
        """Parse RBC CSV into structured transactions."""
        transactions = []
        reader = csv.reader(io.StringIO(csv_content))
        
        # Skip header row
        header = next(reader, None)
        if not header:
            return []
        
        # Expected columns: Account Type, Account Number, Transaction Date, 
        # Cheque Number, Description 1, Description 2, CAD$, USD$
        for idx, row in enumerate(reader):
            if len(row) < 7:
                continue
            
            # Parse amounts (handle empty strings)
            cad_amount = None
            usd_amount = None
            try:
                if row[6] and row[6].strip():
                    cad_amount = float(row[6].strip())
            except (ValueError, IndexError):
                pass
            try:
                if len(row) > 7 and row[7] and row[7].strip():
                    usd_amount = float(row[7].strip())
            except (ValueError, IndexError):
                pass
            
            transactions.append({
                "index": idx,
                "account_type": row[0].strip() if row[0] else "",
                "account_number": row[1].strip() if row[1] else "",
                "transaction_date": row[2].strip() if row[2] else "",
                "cheque_number": row[3].strip() if row[3] else "",
                "description1": row[4].strip() if row[4] else "",
                "description2": row[5].strip() if row[5] else "",
                "amount_cad": cad_amount,
                "amount_usd": usd_amount,
            })
        
        return transactions
    
    async def categorize_transactions(self, transactions: List[dict]) -> List[dict]:
        """Use Gemini AI to categorize bank transactions."""
        if not self.model or not transactions:
            # Return with basic rule-based categorization
            return self._rule_based_categorize(transactions)
        
        try:
            # Prepare transaction summary for AI
            tx_summary = []
            for tx in transactions:
                amount = tx.get("amount_cad") or tx.get("amount_usd") or 0
                tx_summary.append(
                    f"[{tx['index']}] Date: {tx['transaction_date']}, "
                    f"Desc1: {tx['description1']}, Desc2: {tx['description2']}, "
                    f"CAD: {tx.get('amount_cad', '')}, USD: {tx.get('amount_usd', '')}"
                )
            
            tx_text = "\n".join(tx_summary)
            
            prompt = f"""{BANK_CATEGORIZATION_PROMPT}

BANK TRANSACTIONS TO CATEGORIZE:
{tx_text}

CATEGORIZE ALL {len(transactions)} TRANSACTIONS AND RETURN JSON ARRAY:"""

            logger.info(f"Sending {len(transactions)} transactions to Gemini for categorization")
            
            # Use resilient generate with retry + fallback + circuit breaker
            response = self.model_factory.generate(
                prompt=prompt,
                operation_name="bank_categorization",
            )
            
            content = response.text.strip()
            logger.info(f"Gemini categorization response: {content[:500]}...")
            
            # Clean markdown if present
            if content.startswith("```"):
                lines = content.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                content = "\n".join(lines).strip()
            
            categorized = json.loads(content)
            
            # Merge AI categorization with parsed transactions
            cat_map = {item["index"]: item for item in categorized}
            
            for tx in transactions:
                ai_data = cat_map.get(tx["index"], {})
                tx["type"] = ai_data.get("type", "expense")
                tx["category"] = ai_data.get("category", "uncategorized")
                tx["payment_source"] = ai_data.get("payment_source", "bank_checking")
                tx["vendor_name"] = ai_data.get("vendor_name", tx["description1"])
                tx["notes"] = ai_data.get("notes", "")
                tx["confidence"] = ai_data.get("confidence", 0.5)
                tx["is_asset_candidate"] = ai_data.get("is_asset_candidate", False)
            
            # Post-AI validation: override AI decisions for obvious patterns
            transactions = self._post_ai_validation(transactions)
            return transactions
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response: {e}")
            return self._rule_based_categorize(transactions)
        except Exception as e:
            logger.error(f"AI categorization failed: {str(e)}")
            return self._rule_based_categorize(transactions)
    
    def _post_ai_validation(self, transactions: List[dict]) -> List[dict]:
        """
        Post-AI safety net: forcibly override AI decisions for patterns 
        that MUST be classified correctly regardless of what AI says.
        This prevents transfers/owner_draws from being misclassified as expenses/income.
        """
        override_count = 0
        for tx in transactions:
            desc1 = (tx.get("description1") or "").lower()
            desc2 = (tx.get("description2") or "").lower()
            original_type = tx.get("type", "")
            
            # === FORCED TRANSFER patterns ===
            if "funds transfer" in desc1 or "funds transfer" in desc2:
                if tx.get("type") != "transfer":
                    logger.info(f"Override: '{tx.get('description1')}' from '{original_type}' to 'transfer'")
                    tx["type"] = "transfer"
                    tx["category"] = "transfer"
                    tx["vendor_name"] = "Internal Transfer"
                    tx["notes"] = "Inter-account funds transfer"
                    override_count += 1
            
            elif _is_credit_card_payment_thank_you(desc1) or _is_credit_card_payment_thank_you(desc2):
                if tx.get("type") != "transfer":
                    logger.info(f"Override: '{tx.get('description1')}' from '{original_type}' to 'transfer'")
                    tx["type"] = "transfer"
                    tx["category"] = "transfer"
                    tx["vendor_name"] = "Credit Card Payment"
                    tx["notes"] = "Credit card bill payment (not income/expense)"
                    override_count += 1
            
            elif "online banking transfer" in desc1:
                if tx.get("type") != "transfer":
                    tx["type"] = "transfer"
                    tx["category"] = "transfer"
                    tx["vendor_name"] = "Internal Transfer"
                    tx["notes"] = "Online banking transfer"
                    override_count += 1
            
            elif "credit memo" in desc1 and ("exchange" in desc2 or "transfer" in desc2 or "client request" in desc2):
                if tx.get("type") != "transfer":
                    tx["type"] = "transfer"
                    tx["category"] = "transfer"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Bank credit memo / internal adjustment"
                    override_count += 1
            
            # === FORCED OWNER_DRAW patterns ===
            elif "cash withdrawal" in desc1 or "atm withdrawal" in desc1:
                if tx.get("type") != "owner_draw":
                    logger.info(f"Override: '{tx.get('description1')}' from '{original_type}' to 'owner_draw'")
                    tx["type"] = "owner_draw"
                    tx["category"] = "owner_draw"
                    tx["vendor_name"] = "Cash Withdrawal"
                    tx["notes"] = "Cash withdrawal from business account (owner draw)"
                    override_count += 1
            
            elif "debit memo" in desc1 and ("owner" in desc2 or "draw" in desc2):
                if tx.get("type") != "owner_draw":
                    tx["type"] = "owner_draw"
                    tx["category"] = "owner_draw"
                    tx["vendor_name"] = "Owner Draw"
                    tx["notes"] = "Owner withdrawal"
                    override_count += 1
            
            # === FORCED TAX_REFUND patterns (government refunds are NOT income) ===
            elif any(kw in desc1 or kw in desc2 for kw in ["gst", "hst", "receiver general", "rec gen", "canada revenue", "cra"]):
                amount = tx.get("amount_cad") or tx.get("amount_usd") or 0
                if amount > 0 and tx.get("type") != "tax_refund":
                    logger.info(f"Override: '{tx.get('description1')}' from '{original_type}' to 'tax_refund' (government tax refund)")
                    tx["type"] = "tax_refund"
                    tx["category"] = "tax_refund"
                    tx["vendor_name"] = "CRA / Receiver General"
                    tx["notes"] = "Government tax refund (GST/HST ITC) - NOT revenue"
                    override_count += 1
            
            elif "fed govt" in desc1 or "fed govt" in desc2:
                amount = tx.get("amount_cad") or tx.get("amount_usd") or 0
                if amount > 0 and tx.get("type") != "tax_refund":
                    logger.info(f"Override: '{tx.get('description1')}' from '{original_type}' to 'tax_refund' (federal govt deposit)")
                    tx["type"] = "tax_refund"
                    tx["category"] = "tax_refund"
                    tx["vendor_name"] = "Federal Government"
                    tx["notes"] = "Government refund/credit - NOT revenue"
                    override_count += 1
            
            # === e-Transfer to/from owner/family ===
            elif ("e-transfer" in desc1 or "autodeposit" in desc1) and any(name in desc2 for name in ["yeliz bektas", "ozan bektas", "yeliz", "bektas"]):
                amount = tx.get("amount_cad") or tx.get("amount_usd") or 0
                if amount > 0:
                    # Money coming IN from owner = contribution/transfer
                    if tx.get("type") != "transfer":
                        tx["type"] = "transfer"
                        tx["category"] = "transfer"
                        tx["vendor_name"] = "Owner Contribution"
                        tx["notes"] = "Owner e-Transfer to business (not revenue)"
                        override_count += 1
                else:
                    # Money going OUT to owner = owner draw
                    if tx.get("type") != "owner_draw":
                        tx["type"] = "owner_draw"
                        tx["category"] = "owner_draw"
                        tx["vendor_name"] = tx.get("description2", "").split(",")[0] if tx.get("description2") else "Owner"
                        tx["notes"] = "Personal e-Transfer (owner draw)"
                        override_count += 1
            
            # RBC USD: Business PAD / TCH debits are RXO fuel — never rent_lease
            if _is_rbc_usd_business_pad_tch_expense(tx):
                prev = tx.get("category")
                tx["category"] = "fuel"
                tx["vendor_name"] = "RXO"
                tx["notes"] = "Fuel — RXO (RBC USD Business PAD / TCH)"
                if prev != "fuel":
                    logger.info(
                        "Override: USD Business PAD+TCH -> fuel (RXO), was category=%s",
                        prev,
                    )
                    override_count += 1

            # E-ZPass debits from Bank of America (USD chequing — not RBC)
            if (
                tx.get("type") == "expense"
                and ("ezpass" in desc1 or "e-zpass" in desc1)
                and "bank of america" in desc2
                and tx.get("category") != "tolls_scales"
            ):
                tx["category"] = "tolls_scales"
                tx["vendor_name"] = "E-ZPass (Bank of America)"
                tx["notes"] = "US E-ZPass replenishment (Bank of America checking)"
                logger.info("Override: E-ZPass + BoA -> tolls_scales")
                override_count += 1
        
        if override_count > 0:
            logger.warning(f"Post-AI validation: overrode {override_count} AI classifications")
        
        return transactions
    
    def _rule_based_categorize(self, transactions: List[dict]) -> List[dict]:
        """Fallback rule-based categorization when AI is unavailable."""
        for tx in transactions:
            desc1 = (tx.get("description1") or "").lower()
            desc2 = (tx.get("description2") or "").lower()
            amount = tx.get("amount_cad") or tx.get("amount_usd") or 0
            
            # ===== FORCED OVERRIDES (regardless of amount sign) =====
            # These patterns MUST be classified correctly no matter what
            if "funds transfer" in desc1 or "funds transfer" in desc2:
                tx["type"] = "transfer"
                tx["category"] = "transfer"
                tx["vendor_name"] = "Internal Transfer"
                tx["notes"] = "Inter-account funds transfer"
            elif _is_credit_card_payment_thank_you(desc1):
                tx["type"] = "transfer"
                tx["category"] = "transfer"
                tx["vendor_name"] = "Credit Card Payment"
                tx["notes"] = "Credit card bill payment (not income/expense)"
            elif "online banking transfer" in desc1:
                tx["type"] = "transfer"
                tx["category"] = "transfer"
                tx["vendor_name"] = "Internal Transfer"
                tx["notes"] = "Online banking transfer"
            elif "cash withdrawal" in desc1 or "atm withdrawal" in desc1:
                tx["type"] = "owner_draw"
                tx["category"] = "owner_draw"
                tx["vendor_name"] = "Cash Withdrawal"
                tx["notes"] = "Cash withdrawal from business account"
            elif "debit memo" in desc1 and ("owner" in desc2 or "draw" in desc2):
                tx["type"] = "owner_draw"
                tx["category"] = "owner_draw"
                tx["vendor_name"] = "Owner Draw"
                tx["notes"] = "Owner withdrawal"
            elif ("e-transfer" in desc1 or "autodeposit" in desc1) and any(name in desc2 for name in ["yeliz bektas", "ozan bektas", "yeliz", "bektas"]):
                if amount > 0:
                    tx["type"] = "transfer"
                    tx["category"] = "transfer"
                    tx["vendor_name"] = "Owner Contribution"
                    tx["notes"] = "Owner e-Transfer to business (not revenue)"
                else:
                    tx["type"] = "owner_draw"
                    tx["category"] = "owner_draw"
                    tx["vendor_name"] = tx.get("description2", "").split(",")[0] if tx.get("description2") else "Owner"
                    tx["notes"] = "Personal e-Transfer (owner draw)"
            elif "credit memo" in desc1 and ("exchange" in desc2 or "transfer" in desc2 or "client request" in desc2):
                tx["type"] = "transfer"
                tx["category"] = "transfer"
                tx["vendor_name"] = "RBC"
                tx["notes"] = "Bank credit memo / internal adjustment"
            
            # ===== TAX REFUNDS (government deposits - NOT income) =====
            elif amount > 0 and any(kw in desc1 or kw in desc2 for kw in ["gst", "hst", "receiver general", "rec gen", "canada revenue", "cra"]):
                tx["type"] = "tax_refund"
                tx["category"] = "tax_refund"
                tx["vendor_name"] = "CRA / Receiver General"
                tx["notes"] = "Government tax refund (GST/HST ITC) - NOT revenue"
            elif amount > 0 and ("fed govt" in desc1 or "fed govt" in desc2):
                tx["type"] = "tax_refund"
                tx["category"] = "tax_refund"
                tx["vendor_name"] = "Federal Government"
                tx["notes"] = "Government refund/credit - NOT revenue"
            
            # ===== POSITIVE AMOUNTS (income) =====
            elif amount > 0:
                if "j d factors" in desc2:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = "J D Factors"
                    tx["notes"] = "Factoring payment received"
                elif "credit memo" in desc1:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Bank credit"
                elif "cash back reward" in desc1:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Cash back reward"
                elif "deposit" in desc1:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = tx["description1"]
                    tx["notes"] = "Deposit"
                elif "misc payment" in desc1:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = tx.get("description2", "") or tx["description1"]
                    tx["notes"] = "Payment received"
                elif "e-transfer" in desc1 or "autodeposit" in desc1:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = tx.get("description2", "").split(" - ")[-1].strip() if tx.get("description2") else tx["description1"]
                    tx["notes"] = "e-Transfer received"
                else:
                    tx["type"] = "income"
                    tx["category"] = "income"
                    tx["vendor_name"] = tx["description1"]
            else:
                # ===== NEGATIVE AMOUNTS (expenses) =====
                # Note: transfers, owner_draws, cash withdrawals are already handled above
                tx["type"] = "expense"
                tx["payment_source"] = "bank_checking"
                
                if "auto insurance" in desc1 or "icbc" in desc2:
                    tx["category"] = "insurance"
                    tx["vendor_name"] = "ICBC"
                    tx["notes"] = "Auto insurance premium"
                elif "insurance" in desc1 and "cafo" in desc2:
                    tx["category"] = "insurance"
                    tx["vendor_name"] = "CAFO Inc"
                    tx["notes"] = "Insurance premium"
                elif "direct deposits" in desc1 or "pay emp" in desc2:
                    tx["category"] = "payroll"
                    tx["vendor_name"] = "Employee Payroll"
                    tx["notes"] = "Employee payment"
                elif "commercial taxes" in desc1 or "emptx" in desc2:
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = "CRA"
                    tx["notes"] = "Tax remittance"
                elif "monthly fee" in desc1 or "electronic transaction fee" in desc1 or "service fee" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Bank fee"
                elif "items on deposit fee" in desc1 or "in branch cash deposited fee" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Bank fee"
                elif "online banking wire fee" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Wire transfer fee"
                elif "business pad" in desc1 and ("tch" in desc1 or "tch" in desc2):
                    if _transaction_row_is_usd_account(tx):
                        tx["category"] = "fuel"
                        tx["vendor_name"] = "RXO"
                        tx["notes"] = "Fuel — RXO (RBC USD Business PAD / TCH)"
                    else:
                        tx["category"] = "rent_lease"
                        tx["vendor_name"] = "TCH Canada"
                        tx["notes"] = "Truck/equipment lease payment (CAD — TCH Canada)"
                elif "e-transfer sent" in desc1 or "e-transfer" in desc1:
                    tx["category"] = "other_expenses"
                    tx["payment_source"] = "e_transfer"
                    tx["vendor_name"] = tx.get("description2", "").split(",")[0] if tx.get("description2") else ""
                    tx["notes"] = "e-Transfer payment"
                elif "interac e-transfer fee" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "e-Transfer fee"
                elif "bill payment" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = tx.get("description2", "").replace("PAY-", "") if tx.get("description2") else ""
                    tx["notes"] = "Bill payment"
                elif "prov/local gvt" in desc1:
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = tx.get("description2", "")
                    tx["notes"] = "Government payment"
                elif "online banking wire payment" in desc1:
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = tx.get("description2", "") or "Wire Payment"
                    tx["notes"] = "Wire payment"
                elif "purchase interest" in desc1 or "interest charge" in desc1:
                    tx["category"] = "loan_interest"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Credit card / loan interest"
                elif "minimum charge" in desc1 or "cash advance fee" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = "RBC Card"
                    tx["notes"] = "Credit card fee"
                elif any(
                    kw in desc1 or kw in desc2
                    for kw in ["dtops", "prepass", "ezpass", "e-zpass", "e zpass", "cat scale"]
                ):
                    tx["category"] = "tolls_scales"
                    if any(x in desc1 for x in ["ezpass", "e-zpass", "e zpass"]):
                        tx["vendor_name"] = (
                            "E-ZPass (Bank of America)"
                            if "bank of america" in desc2
                            else "E-ZPass"
                        )
                    else:
                        tx["vendor_name"] = tx["description1"][:72]
                    if "bank of america" in desc2 and "ezpass" in desc1:
                        tx["notes"] = "US E-ZPass replenishment (Bank of America checking)"
                    else:
                        tx["notes"] = "Toll / scale / weigh (US)"
                elif "bank of america" in desc2 and ("toll" in desc1 or "ezpass" in desc1 or "e-zpass" in desc1):
                    tx["category"] = "tolls_scales"
                    tx["vendor_name"] = "E-ZPass (Bank of America)"
                    tx["notes"] = "US toll replenishment paid from BoA checking"
                elif desc1.startswith("cbp ") or " cbp " in desc1:
                    tx["category"] = "tolls_scales"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Border / CBP fee (US)"
                elif "odot" in desc1:
                    tx["category"] = "tolls_scales"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Ohio DOT toll / road charge"
                elif "unified carrier regist" in desc1:
                    tx["category"] = "licenses_dues"
                    tx["vendor_name"] = "UCR / Unified Carrier Registration"
                    tx["notes"] = "US carrier registration"
                elif any(kw in desc1 for kw in ["truck unload", "lineagelogistic", "kehe distribut"]):
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Lumper / warehouse unload (trucking)"
                elif any(kw in desc1 for kw in ["nm tax & revenue", "ct dor", "aci*ct dor"]):
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "US state tax / permit portal"
                elif "svc fee odot" in desc1 or "odot internet" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "ODOT online service fee"
                elif any(kw in desc1 for kw in ["commercial tire", "les schwab", "love's tire", "eddie's truck"]):
                    tx["category"] = "maintenance_repairs"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Tires / truck auto (US)"
                elif "fleetsmarts" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = "FleetSmarts"
                    tx["notes"] = "Fleet / telematics software"
                elif "openai" in desc1 or "cursor" in desc1 or "iyizico" in desc1:
                    tx["category"] = "office_admin"
                    tx["vendor_name"] = tx["description1"][:48]
                    tx["notes"] = "Software / hosting / AI subscription"
                elif "tractor supply" in desc1:
                    tx["category"] = "maintenance_repairs"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Truck / shop supplies"
                elif any(kw in desc1 for kw in ["justice ct", "justice court", "county justice"]):
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Court / civil fee (verify)"
                elif "hospital" in desc1:
                    tx["category"] = "other_expenses"
                    tx["vendor_name"] = tx["description1"][:72]
                    tx["notes"] = "Medical (verify business purpose)"
                elif any(kw in desc1 or kw in desc2 for kw in ["petro-canada", "shell", "esso", "husky", "flying j", "chevron"]):
                    tx["category"] = "fuel"
                    tx["vendor_name"] = tx["description1"].split(" - ")[0].strip() if " - " in tx["description1"] else tx["description1"]
                    tx["notes"] = "Fuel purchase"
                elif any(kw in desc1 or kw in desc2 for kw in ["denny", "tim horton", "mcdonald", "subway", "restaurant", "kfc", "carl's jr", "taco bell", "7-eleven", "king soopers", "grocery outlet"]):
                    tx["category"] = "meals_entertainment"
                    tx["vendor_name"] = tx["description1"].split(" - ")[0].strip() if " - " in tx["description1"] else tx["description1"]
                    tx["notes"] = "Meal/food purchase"
                else:
                    tx["category"] = "uncategorized"
                    tx["vendor_name"] = tx["description1"]
            
            tx["confidence"] = 0.7  # Rule-based confidence
        
        return transactions


# Lazy initialization
_bank_service_instance = None

def get_bank_service() -> BankCategorizationService:
    global _bank_service_instance
    if _bank_service_instance is None:
        _bank_service_instance = BankCategorizationService()
    return _bank_service_instance


@router.post("/parse", response_model=ParseBankCSVResponse)
async def parse_bank_csv(request: ParseBankCSVRequest):
    """
    Parse an RBC bank CSV file and categorize transactions using AI.
    
    Expected CSV format (RBC):
    Account Type, Account Number, Transaction Date, Cheque Number,
    Description 1, Description 2, CAD$, USD$
    
    Returns categorized transactions ready for review and import.
    """
    try:
        service = get_bank_service()
        
        # Step 1: Parse CSV
        raw_transactions = service.parse_csv(request.csv_content)
        
        if not raw_transactions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid transactions found in CSV file"
            )
        
        logger.info(f"Parsed {len(raw_transactions)} transactions from CSV")
        
        # Step 2: Categorize with AI
        categorized = await service.categorize_transactions(raw_transactions)
        
        # Step 3: Build response
        transactions = []
        total_income = 0
        total_expenses = 0
        total_transfers = 0
        total_tax_refunds = 0
        
        for tx in categorized:
            # Use whichever amount column has data (CAD account vs USD account)
            amount = tx.get("amount_cad") or tx.get("amount_usd") or 0
            
            if tx.get("type") == "income":
                total_income += abs(amount)
            elif tx.get("type") in ("expense", "owner_draw"):
                total_expenses += abs(amount)
            elif tx.get("type") == "transfer":
                total_transfers += abs(amount)
            elif tx.get("type") == "tax_refund":
                total_tax_refunds += abs(amount)
            
            transactions.append(BankTransaction(
                index=tx["index"],
                transaction_date=tx.get("transaction_date", ""),
                description1=tx.get("description1", ""),
                description2=tx.get("description2", ""),
                amount_cad=tx.get("amount_cad"),
                amount_usd=tx.get("amount_usd"),
                type=tx.get("type", "expense"),
                category=tx.get("category", "uncategorized"),
                payment_source=tx.get("payment_source", "bank_checking"),
                vendor_name=tx.get("vendor_name", ""),
                notes=tx.get("notes", ""),
                confidence=tx.get("confidence", 0.5),
            ))
        
        # Detect if this is a USD or CAD account based on which column has data
        has_cad = any(tx.get("amount_cad") is not None and tx.get("amount_cad") != 0 for tx in categorized)
        has_usd = any(tx.get("amount_usd") is not None and tx.get("amount_usd") != 0 for tx in categorized)
        account_currency = "USD" if has_usd and not has_cad else "CAD" if has_cad and not has_usd else "MIXED"
        
        summary = {
            "total_transactions": len(transactions),
            "total_income": round(total_income, 2),
            "total_expenses": round(total_expenses, 2),
            "total_transfers": round(total_transfers, 2),
            "total_tax_refunds": round(total_tax_refunds, 2),
            "expense_count": sum(1 for t in transactions if t.type == "expense"),
            "income_count": sum(1 for t in transactions if t.type == "income"),
            "transfer_count": sum(1 for t in transactions if t.type == "transfer"),
            "tax_refund_count": sum(1 for t in transactions if t.type == "tax_refund"),
            "account_currency": account_currency,
        }
        
        logger.info(f"Categorized {len(transactions)} transactions: "
                    f"{summary['expense_count']} expenses, "
                    f"{summary['income_count']} income, "
                    f"{summary['transfer_count']} transfers, "
                    f"{summary.get('tax_refund_count', 0)} tax refunds")
        
        return ParseBankCSVResponse(transactions=transactions, summary=summary)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing bank CSV: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error parsing bank CSV: {str(e)}"
        )
