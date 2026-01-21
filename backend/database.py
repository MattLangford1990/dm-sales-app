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


# ============ Faire Integration Models ============

class FaireOrder(Base):
    """Tracks orders received from Faire marketplace"""
    __tablename__ = "faire_orders"
    
    id = Column(String, primary_key=True)  # UUID
    faire_order_id = Column(String, unique=True, nullable=False)  # Faire's order ID
    faire_brand_token = Column(String, nullable=False)  # Which brand storefront
    brand_name = Column(String, nullable=False)  # e.g. "My Flame"
    
    # Retailer info
    retailer_id = Column(String, nullable=True)  # Faire retailer ID
    retailer_name = Column(String, nullable=False)
    retailer_email = Column(String, nullable=True)
    
    # Address (for agent territory matching)
    ship_city = Column(String, nullable=True)
    ship_region = Column(String, nullable=True)  # County/State
    ship_postcode = Column(String, nullable=True)
    ship_country = Column(String, default="GB")
    
    # Order details
    order_total_cents = Column(Float, default=0)  # Store in cents to avoid float issues
    currency = Column(String, default="GBP")
    item_count = Column(Float, default=0)
    order_items_json = Column(Text, nullable=True)  # JSON of line items for reference
    
    # Status tracking
    faire_state = Column(String, default="NEW")  # NEW, PROCESSING, PRE_TRANSIT, IN_TRANSIT, DELIVERED, CANCELED
    
    # Zoho integration
    zoho_customer_id = Column(String, nullable=True)  # Created "Faire - [Retailer]" customer
    zoho_sales_order_id = Column(String, nullable=True)
    zoho_sales_order_number = Column(String, nullable=True)
    synced_to_zoho_at = Column(DateTime, nullable=True)
    
    # Agent assignment (based on territory)
    assigned_agent_id = Column(String, nullable=True)  # From postcode/region lookup
    
    # Shipment tracking
    shipped_at = Column(DateTime, nullable=True)
    tracking_number = Column(String, nullable=True)
    carrier = Column(String, nullable=True)
    tracking_pushed_to_faire = Column(Boolean, default=False)
    
    # Timestamps
    faire_created_at = Column(DateTime, nullable=True)  # When order was placed on Faire
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FaireProductMapping(Base):
    """Maps Zoho SKUs to Faire product/variant IDs"""
    __tablename__ = "faire_product_mapping"
    
    id = Column(String, primary_key=True)  # UUID
    
    # Zoho side
    zoho_sku = Column(String, nullable=False)  # Our internal SKU
    zoho_item_id = Column(String, nullable=True)  # Zoho item ID if needed
    
    # Faire side
    faire_product_id = Column(String, nullable=True)  # Faire's product ID
    faire_product_option_id = Column(String, nullable=True)  # Faire's variant ID
    
    # Brand
    brand_name = Column(String, nullable=False)  # e.g. "My Flame"
    
    # Sync status
    is_synced = Column(Boolean, default=False)  # Has been pushed to Faire
    last_synced_at = Column(DateTime, nullable=True)
    sync_error = Column(Text, nullable=True)  # Last error if any
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FaireBrandConfig(Base):
    """Configuration for each brand's Faire storefront"""
    __tablename__ = "faire_brand_config"
    
    id = Column(String, primary_key=True)  # brand_name as ID
    brand_name = Column(String, unique=True, nullable=False)  # e.g. "My Flame"
    
    # API credentials
    faire_access_token = Column(String, nullable=True)  # X-FAIRE-ACCESS-TOKEN
    
    # Settings
    is_active = Column(Boolean, default=False)  # Enable/disable sync
    sync_inventory = Column(Boolean, default=True)  # Auto-sync stock levels
    inventory_buffer = Column(Float, default=0)  # Subtract from actual stock (safety buffer)
    
    # Sync schedule
    last_inventory_sync = Column(DateTime, nullable=True)
    last_order_check = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FaireWebhookLog(Base):
    """Log of incoming Faire webhooks for debugging"""
    __tablename__ = "faire_webhook_log"
    
    id = Column(String, primary_key=True)  # UUID
    webhook_type = Column(String, nullable=False)  # e.g. "ORDER_CREATED"
    faire_order_id = Column(String, nullable=True)
    payload_json = Column(Text, nullable=True)  # Full webhook payload
    processed = Column(Boolean, default=False)
    error = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)


# Initialize on import
init_db()
