"""Bank CSV Import router - Parse RBC bank statements and categorize transactions."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
import logging
import csv
import io
import json
import google.generativeai as genai

from config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Valid expense categories for AI categorization
VALID_CATEGORIES = [
    "fuel", "maintenance_repairs", "insurance", "licenses_dues",
    "tolls_scales", "meals_entertainment", "travel_lodging", "office_admin",
    "factoring_fees", "payroll", "subcontractor", "professional_fees",
    "rent_lease", "loan_interest", "other_expenses", "uncategorized"
]

# Gemini prompt for bank transaction categorization
BANK_CATEGORIZATION_PROMPT = """You are an expert Canadian accountant for a trucking/logistics company (BACKTAS GLOBAL LOGISTICS ULC).
You need to categorize bank transactions from an RBC business chequing account.
The account may be either a CAD account or a USD account - check the column amounts.

COMPANY CONTEXT:
- Trucking/logistics company operating in Canada and USA
- Uses J D Factors as factoring company for freight invoices (both CAD and USD accounts)
- Has ICBC truck/trailer insurance policies
- Pays employees via Direct Deposits and e-Transfers
- Common vendors: ICBC (insurance), CAFO Inc (insurance), J D Factors (factoring)
- Has "TCH CANADA" / "Business PAD" recurring payments (truck lease or equipment payments)
- Company has two RBC accounts: one CAD (07760-1001270) and one USD (07760-4001350)
- Owner names: "Yeliz Bektas", "Ozan Bektas"

⚠️ CRITICAL - MUST CLASSIFY THESE AS "transfer" (NOT income, NOT expense):
   - "Funds transfer" (ANY direction, positive or negative) = ALWAYS "transfer"
   - "PAYMENT - THANK YOU / PAIEMENT - MERCI" = Credit card payment = ALWAYS "transfer"
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
   - ⚠️ NEVER classify "Funds transfer", "PAYMENT - THANK YOU", "Credit Memo" as income!
   - ⚠️ NEVER classify GST/HST refunds, RECEIVER GENERAL, CRA deposits as income! Use "tax_refund"!

2. EXPENSES (negative amounts) - classify with one of these categories:
   - "insurance": ICBC, CAFO Inc, any insurance premium
   - "payroll": "Direct Deposits (PDS)", "PAY EMP-VENDOR", salary/wage payments
   - "office_admin": "Monthly fee", "Electronic transaction fee", "Bill Payment PAY-FILE FEES", "INTERAC e-Transfer fee", "Service fee", "Items on deposit fee", "In branch cash deposited fee", "Online Banking wire fee", bank charges
   - "factoring_fees": Any J D Factors fees or charges (NOT incoming payments)
   - "other_expenses": "COMMERCIAL TAXES", "EMPTX", tax remittances
   - "rent_lease": "Business PAD" + "TCH CANADA" = truck/equipment lease payments
   - "subcontractor": e-Transfer to known contractors/drivers
   - "professional_fees": Payments to accountants, lawyers, consultants
   - "loan_interest": Loan payments, "PURCHASE INTEREST"
   - "fuel": Gas station, fuel, PETRO-CANADA, SHELL
   - "maintenance_repairs": Vehicle repairs, parts
   - "licenses_dues": Government permits, licenses
   - "tolls_scales": Tolls, bridge fees, scale fees
   - "meals_entertainment": Restaurants, food, DENNY'S, TIM HORTONS
   - "travel_lodging": Hotels, motels
   - "uncategorized": Cannot determine category
   - ⚠️ NEVER classify "Funds transfer", "Cash withdrawal" as expense!

3. TRANSFERS/NON-BUSINESS (MUST flag correctly):
   - "Funds transfer" (positive OR negative) = ALWAYS "transfer"
   - "PAYMENT - THANK YOU / PAIEMENT - MERCI" = ALWAYS "transfer" (credit card payment)
   - "Online Banking transfer" = ALWAYS "transfer"
   - "Cash withdrawal" = ALWAYS "owner_draw"
   - "ATM withdrawal" = ALWAYS "owner_draw"
   - "Debit Memo" + "OWNER" = ALWAYS "owner_draw"
   - e-Transfer to/from "Yeliz Bektas" or "Ozan Bektas" = "owner_draw" (sent) or "transfer" (received)

4. PAYMENT SOURCE:
   - "bank_checking" for all direct debits, auto-payments, bill payments
   - "e_transfer" for e-Transfers

RESPOND WITH ONLY a JSON array. Each element should have:
{
  "index": number (0-based row index),
  "type": "expense" | "income" | "transfer" | "owner_draw" | "tax_refund",
  "category": "one of the valid categories or 'income' or 'transfer' or 'owner_draw' or 'tax_refund'",
  "payment_source": "bank_checking" | "e_transfer",
  "vendor_name": "cleaned up vendor/payee name",
  "notes": "brief note about what this transaction is",
  "confidence": number 0.0-1.0
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


class ParseBankCSVRequest(BaseModel):
    """Request body with CSV content."""
    csv_content: str


class ParseBankCSVResponse(BaseModel):
    """Response with parsed and categorized transactions."""
    transactions: List[BankTransaction]
    summary: dict


class BankCategorizationService:
    """Service for parsing and categorizing bank transactions."""
    
    def __init__(self):
        try:
            api_key = settings.gemini_api_key
            if not api_key:
                logger.warning("No Gemini API key found. AI categorization disabled.")
                self.model = None
                return
            
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(
                model_name="gemini-2.0-flash",
                generation_config={
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "max_output_tokens": 8192,
                }
            )
            logger.info("Bank categorization service initialized")
        except Exception as e:
            logger.error(f"Failed to initialize bank categorization service: {str(e)}")
            self.model = None
    
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
            response = self.model.generate_content(prompt)
            
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
            
            elif "payment - thank you" in desc1 or "paiement - merci" in desc1 or "payment - thank you" in desc2:
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
            elif "payment - thank you" in desc1 or "paiement - merci" in desc1:
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
                elif "business pad" in desc1 and "tch canada" in desc2:
                    tx["category"] = "rent_lease"
                    tx["vendor_name"] = "TCH Canada"
                    tx["notes"] = "Truck/equipment lease payment"
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
                elif "purchase interest" in desc1:
                    tx["category"] = "loan_interest"
                    tx["vendor_name"] = "RBC"
                    tx["notes"] = "Credit card / loan interest"
                elif any(kw in desc1 or kw in desc2 for kw in ["petro-canada", "shell", "esso", "husky", "flying j"]):
                    tx["category"] = "fuel"
                    tx["vendor_name"] = tx["description1"].split(" - ")[0].strip() if " - " in tx["description1"] else tx["description1"]
                    tx["notes"] = "Fuel purchase"
                elif any(kw in desc1 or kw in desc2 for kw in ["denny", "tim horton", "mcdonald", "subway", "restaurant"]):
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
