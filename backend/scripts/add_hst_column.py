"""
Migration script to add hst_amount column to expenses table.
This separates HST from GST for accurate Canadian tax reporting.

Run this script once to update the database schema.
"""

import sqlite3
import os

# Database path
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'quickyel.db')

def migrate():
    """Add tax columns to expenses table if they don't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Check existing columns
        cursor.execute("PRAGMA table_info(expenses)")
        columns = [col[1] for col in cursor.fetchall()]
        
        # Add gst_amount if missing
        if 'gst_amount' not in columns:
            print("Adding gst_amount column to expenses table...")
            cursor.execute("ALTER TABLE expenses ADD COLUMN gst_amount FLOAT DEFAULT 0.0")
            conn.commit()
            print("[OK] gst_amount column added successfully!")
        else:
            print("[OK] gst_amount column already exists.")
        
        # Add hst_amount if missing
        if 'hst_amount' not in columns:
            print("Adding hst_amount column to expenses table...")
            cursor.execute("ALTER TABLE expenses ADD COLUMN hst_amount FLOAT DEFAULT 0.0")
            conn.commit()
            print("[OK] hst_amount column added successfully!")
        else:
            print("[OK] hst_amount column already exists.")
        
        # Add pst_amount if missing
        if 'pst_amount' not in columns:
            print("Adding pst_amount column to expenses table...")
            cursor.execute("ALTER TABLE expenses ADD COLUMN pst_amount FLOAT DEFAULT 0.0")
            conn.commit()
            print("[OK] pst_amount column added successfully!")
        else:
            print("[OK] pst_amount column already exists.")
        
        # Verify all tax columns exist
        cursor.execute("PRAGMA table_info(expenses)")
        columns = [col[1] for col in cursor.fetchall()]
        
        tax_columns = ['gst_amount', 'hst_amount', 'pst_amount', 'tax_amount']
        for col in tax_columns:
            if col in columns:
                print(f"  [OK] {col} exists")
            else:
                print(f"  [MISSING] {col} - please check schema")
        
        print("\n[OK] Migration completed successfully!")
        print("\nTax columns are now:")
        print("  - gst_amount: GST (5%) - Federal tax, ITC recoverable")
        print("  - hst_amount: HST (13-15%) - Harmonized tax, ITC recoverable")
        print("  - pst_amount: PST (6-10%) - Provincial tax, NOT recoverable")
        print("  - tax_amount: Total tax (sum of GST + HST + PST)")
        
    except Exception as e:
        print(f"Error during migration: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()

