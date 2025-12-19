#!/usr/bin/env python3
"""
Migration script to add sort_order column to catalogues table.
Run this once after deploying the code changes.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import engine, SessionLocal

def run_migration():
    """Add sort_order column to catalogues table if it doesn't exist"""
    db = SessionLocal()
    try:
        # Check if column exists
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'catalogues' AND column_name = 'sort_order'
        """))
        
        if result.fetchone() is None:
            print("Adding sort_order column to catalogues table...")
            db.execute(text("ALTER TABLE catalogues ADD COLUMN sort_order FLOAT DEFAULT 0"))
            db.commit()
            print("✓ Column added successfully")
            
            # Set initial sort order based on created_at
            print("Setting initial sort order values...")
            db.execute(text("""
                UPDATE catalogues 
                SET sort_order = subquery.row_num
                FROM (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) - 1 as row_num
                    FROM catalogues
                ) AS subquery
                WHERE catalogues.id = subquery.id
            """))
            db.commit()
            print("✓ Initial sort order values set")
        else:
            print("✓ sort_order column already exists")
            
    except Exception as e:
        print(f"Migration error: {e}")
        # SQLite fallback
        if "no such table: information_schema" in str(e).lower() or "syntax error" in str(e).lower():
            print("Attempting SQLite-compatible migration...")
            try:
                # For SQLite, just try to add the column and ignore if it exists
                db.execute(text("ALTER TABLE catalogues ADD COLUMN sort_order FLOAT DEFAULT 0"))
                db.commit()
                print("✓ Column added successfully (SQLite)")
            except Exception as sqlite_err:
                if "duplicate column" in str(sqlite_err).lower():
                    print("✓ sort_order column already exists (SQLite)")
                else:
                    print(f"SQLite migration error: {sqlite_err}")
    finally:
        db.close()

if __name__ == "__main__":
    print("Running catalogue sort_order migration...")
    run_migration()
    print("Migration complete!")
