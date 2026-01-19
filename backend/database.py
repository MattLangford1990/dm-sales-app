# Database connection and models for persistent storage
import os
from sqlalchemy import create_engine, Column, String, Float, Boolean, JSON, DateTime, Text, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

# Get database URL from environment
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Handle Render's postgres:// vs postgresql:// URL format
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Create engine - use SQLite fallback for local development
if DATABASE_URL:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    print(f"DATABASE: Connected to PostgreSQL")
else:
    # Local SQLite fallback
    sqlite_path = os.path.join(os.path.dirname(__file__), "local.db")
    engine = create_engine(f"sqlite:///{sqlite_path}", connect_args={"check_same_thread": False})
    print(f"DATABASE: Using local SQLite at {sqlite_path}")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ============ Models ============

class Agent(Base):
    __tablename__ = "agents"
    
    id = Column(String, primary_key=True)  # e.g. "kate.ellis"
    name = Column(String, nullable=False)
    pin = Column(String, nullable=False)
    commission_rate = Column(Float, default=0.125)
    brands = Column(JSON, default=list)  # List of brand names
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Catalogue(Base):
    __tablename__ = "catalogues"
    
    id = Column(String, primary_key=True)  # e.g. "rader-20241215123456"
    brand = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    url = Column(String, nullable=False)  # External URL to PDF
    size_mb = Column(Float, default=0)
    added_by = Column(String, default="")
    sort_order = Column(Float, default=0)  # For manual ordering (lower = first)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CatalogueRequest(Base):
    """Stores trade show / catalogue request submissions"""
    __tablename__ = "catalogue_requests"
    
    id = Column(String, primary_key=True)  # UUID
    first_name = Column(String, nullable=False)
    surname = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, default="")
    business_name = Column(String, nullable=False)
    address1 = Column(String, nullable=False)
    address2 = Column(String, default="")
    town = Column(String, nullable=False)
    postcode = Column(String, nullable=False)
    catalogue_format = Column(String, nullable=False)  # digital, physical, both
    brands = Column(JSON, default=list)  # List of brand names
    notes = Column(Text, default="")
    captured_by = Column(String, default="")  # Agent name if logged in
    is_read = Column(Boolean, default=False)  # For admin notification
    created_at = Column(DateTime, default=datetime.utcnow)


class ProductFeed(Base):
    """Stores the pre-generated product feed JSON for fast sync"""
    __tablename__ = "product_feeds"
    
    id = Column(String, primary_key=True, default="main")  # Only one feed, always "main"
    feed_json = Column(Text, nullable=False)  # Compressed JSON string
    total_products = Column(Float, default=0)
    generated_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProductCache(Base):
    """Stores the cached product data from Zoho - survives server restarts"""
    __tablename__ = "product_cache"
    
    id = Column(String, primary_key=True, default="main")  # Only one cache, always "main"
    items_json = Column(Text, nullable=False)  # JSON string of all items
    item_count = Column(Float, default=0)
    cached_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============ Database Initialization ============

def init_db():
    """Create all tables and run migrations"""
    Base.metadata.create_all(bind=engine)
    print("DATABASE: Tables created/verified")
    
    # Run migrations for new columns
    run_migrations()


def run_migrations():
    """Add any missing columns to existing tables"""
    with engine.connect() as conn:
        # Check if sort_order column exists in catalogues table
        try:
            if DATABASE_URL:  # PostgreSQL
                result = conn.execute(text("""
                    SELECT column_name FROM information_schema.columns 
                    WHERE table_name = 'catalogues' AND column_name = 'sort_order'
                """))
                if result.fetchone() is None:
                    print("DATABASE: Adding sort_order column to catalogues...")
                    conn.execute(text("ALTER TABLE catalogues ADD COLUMN sort_order FLOAT DEFAULT 0"))
                    conn.commit()
                    print("DATABASE: sort_order column added")
            else:  # SQLite
                # For SQLite, try to add and catch if exists
                try:
                    conn.execute(text("ALTER TABLE catalogues ADD COLUMN sort_order FLOAT DEFAULT 0"))
                    conn.commit()
                    print("DATABASE: sort_order column added (SQLite)")
                except Exception:
                    pass  # Column already exists
        except Exception as e:
            print(f"DATABASE: Migration check - {e}")


def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Initialize on import
init_db()
