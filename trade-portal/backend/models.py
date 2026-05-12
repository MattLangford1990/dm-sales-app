from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Text, create_engine
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()


class TradeAccount(Base):
    __tablename__ = "trade_accounts"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    company_name = Column(String, nullable=False)
    contact_name = Column(String, nullable=False)
    phone = Column(String)
    vat_number = Column(String)
    address_line1 = Column(String)
    address_line2 = Column(String)
    town = Column(String)
    postcode = Column(String)
    country = Column(String, default="United Kingdom")
    # pending → approved → active (or rejected)
    status = Column(String, default="approved", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="account", cascade="all, delete-orphan")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("trade_accounts.id"), nullable=False)
    reference = Column(String, unique=True, nullable=False, index=True)
    status = Column(String, default="received", nullable=False)
    subtotal = Column(Float, default=0.0)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("TradeAccount", back_populates="orders")
    lines = relationship("OrderLine", back_populates="order", cascade="all, delete-orphan")


class OrderLine(Base):
    __tablename__ = "order_lines"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    sku = Column(String, nullable=False)
    name = Column(String, nullable=False)
    brand = Column(String)
    unit_price = Column(Float, nullable=False)
    quantity = Column(Integer, nullable=False)
    line_total = Column(Float, nullable=False)

    order = relationship("Order", back_populates="lines")


# Engine + session setup
engine = create_engine(
    "sqlite:///./trade_portal.db",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db():
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
