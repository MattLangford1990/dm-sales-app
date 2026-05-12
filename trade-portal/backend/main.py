import secrets
from datetime import datetime
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from auth import (
    create_access_token,
    get_current_account,
    hash_password,
    require_approved,
    verify_password,
)
from models import Order, OrderLine, TradeAccount, get_db, init_db
from products_data import BRANDS, PRODUCTS, get_product_by_sku

init_db()

app = FastAPI(title="DM Brands Trade Portal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ───── schemas ─────

class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    company_name: str
    contact_name: str
    phone: Optional[str] = None
    vat_number: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    town: Optional[str] = None
    postcode: Optional[str] = None
    country: Optional[str] = "United Kingdom"


class AccountOut(BaseModel):
    id: int
    email: str
    company_name: str
    contact_name: str
    phone: Optional[str]
    vat_number: Optional[str]
    address_line1: Optional[str]
    address_line2: Optional[str]
    town: Optional[str]
    postcode: Optional[str]
    country: Optional[str]
    status: str

    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    account: AccountOut


class OrderLineIn(BaseModel):
    sku: str
    quantity: int = Field(gt=0)


class OrderIn(BaseModel):
    lines: List[OrderLineIn]
    notes: Optional[str] = None


class OrderLineOut(BaseModel):
    sku: str
    name: str
    brand: Optional[str]
    unit_price: float
    quantity: int
    line_total: float

    class Config:
        from_attributes = True


class OrderOut(BaseModel):
    id: int
    reference: str
    status: str
    subtotal: float
    notes: Optional[str]
    created_at: datetime
    lines: List[OrderLineOut]

    class Config:
        from_attributes = True


# ───── auth ─────

@app.post("/api/auth/signup", response_model=TokenOut)
def signup(data: SignupIn, db: Session = Depends(get_db)):
    existing = db.query(TradeAccount).filter(TradeAccount.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    account = TradeAccount(
        email=data.email,
        password_hash=hash_password(data.password),
        company_name=data.company_name,
        contact_name=data.contact_name,
        phone=data.phone,
        vat_number=data.vat_number,
        address_line1=data.address_line1,
        address_line2=data.address_line2,
        town=data.town,
        postcode=data.postcode,
        country=data.country,
        # Auto-approve for now; flip to "pending" once admin workflow exists.
        status="approved",
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    token = create_access_token(account.id)
    return TokenOut(access_token=token, account=AccountOut.model_validate(account))


@app.post("/api/auth/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    account = db.query(TradeAccount).filter(TradeAccount.email == form.username).first()
    if not account or not verify_password(form.password, account.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    token = create_access_token(account.id)
    return TokenOut(access_token=token, account=AccountOut.model_validate(account))


@app.get("/api/auth/me", response_model=AccountOut)
def me(account: TradeAccount = Depends(get_current_account)):
    return AccountOut.model_validate(account)


# ───── catalogue ─────

@app.get("/api/brands")
def list_brands():
    return BRANDS


@app.get("/api/products")
def list_products(brand: Optional[str] = None, q: Optional[str] = None):
    items = PRODUCTS
    if brand:
        items = [p for p in items if p["brand"] == brand]
    if q:
        ql = q.lower()
        items = [p for p in items if ql in p["name"].lower() or ql in p["sku"].lower()]
    return items


@app.get("/api/products/{sku}")
def get_product(sku: str):
    p = get_product_by_sku(sku)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return p


# ───── orders ─────

def _build_reference() -> str:
    return f"TP-{datetime.utcnow().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"


@app.post("/api/orders", response_model=OrderOut, status_code=201)
def create_order(
    data: OrderIn,
    db: Session = Depends(get_db),
    account: TradeAccount = Depends(require_approved),
):
    if not data.lines:
        raise HTTPException(status_code=400, detail="Order must contain at least one line")

    order = Order(
        account_id=account.id,
        reference=_build_reference(),
        notes=data.notes,
        subtotal=0.0,
    )
    db.add(order)

    subtotal = 0.0
    for line in data.lines:
        product = get_product_by_sku(line.sku)
        if not product:
            raise HTTPException(status_code=400, detail=f"Unknown SKU: {line.sku}")
        line_total = round(product["rate"] * line.quantity, 2)
        subtotal += line_total
        order.lines.append(OrderLine(
            sku=product["sku"],
            name=product["name"],
            brand=product["brand"],
            unit_price=product["rate"],
            quantity=line.quantity,
            line_total=line_total,
        ))

    order.subtotal = round(subtotal, 2)
    db.commit()
    db.refresh(order)
    return OrderOut.model_validate(order)


@app.get("/api/orders", response_model=List[OrderOut])
def list_orders(
    db: Session = Depends(get_db),
    account: TradeAccount = Depends(get_current_account),
):
    orders = (
        db.query(Order)
        .filter(Order.account_id == account.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    return [OrderOut.model_validate(o) for o in orders]


@app.get("/api/orders/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    account: TradeAccount = Depends(get_current_account),
):
    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.account_id == account.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return OrderOut.model_validate(order)


@app.get("/api/health")
def health():
    return {"status": "ok"}
