# Database connection and models for persistent storage
import os
from sqlalchemy import create_engine, Column, String, Float, Boolean, JSON, DateTime, Text
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProductFeed(Base):
    """Stores the pre-generated product feed JSON for fast sync"""
    __tablename__ = "product_feeds"
    
    id = Column(String, primary_key=True, default="main")  # Only one feed, always "main"
    feed_json = Column(Text, nullable=False)  # Compressed JSON string
    total_products = Column(Float, default=0)
    generated_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============ Database Initialization ============

def init_db():
    """Create all tables"""
    Base.metadata.create_all(bind=engine)
    print("DATABASE: Tables created/verified")


def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Initialize on import
init_db()
