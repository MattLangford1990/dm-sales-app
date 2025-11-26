from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timedelta
from jose import JWTError, jwt
from typing import Optional, List, Dict
import re
import os

import json
from config import get_settings
from agents import get_agent, get_agent_brands, verify_agent_pin, list_agents, get_all_brand_patterns
import zoho_api

# Load pack quantities
PACK_QUANTITIES_FILE = os.path.join(os.path.dirname(__file__), "pack_quantities.json")
def load_pack_quantities():
    if os.path.exists(PACK_QUANTITIES_FILE):
        with open(PACK_QUANTITIES_FILE, "r") as f:
            return json.load(f)
    return {}

_pack_quantities = load_pack_quantities()

settings = get_settings()
security = HTTPBearer()

app = FastAPI(
    title="DM Sales App API",
    description="Sales order management for DM Brands agents",
    version="1.0.0"
)

# CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ Pydantic Models ============

class LoginRequest(BaseModel):
    agent_id: str
    pin: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    agent_name: str
    brands: List[str]


class TokenData(BaseModel):
    agent_id: str
    agent_name: str
    brands: List[str]


class CustomerCreate(BaseModel):
    company_name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    billing_address: Optional[Dict] = None


class OrderLineItem(BaseModel):
    item_id: str
    name: str
    sku: str
    quantity: int
    rate: float
    discount_percent: float = 0


class OrderCreate(BaseModel):
    customer_id: str
    customer_name: str
    line_items: List[OrderLineItem]
    notes: Optional[str] = None
    reference_number: Optional[str] = None


# ============ Auth Helpers ============

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


async def get_current_agent(credentials: HTTPAuthorizationCredentials = Depends(security)) -> TokenData:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=[settings.algorithm])
        agent_id: str = payload.get("sub")
        if agent_id is None:
            raise credentials_exception
        return TokenData(
            agent_id=agent_id,
            agent_name=payload.get("agent_name", ""),
            brands=payload.get("brands", [])
        )
    except JWTError:
        raise credentials_exception


# ============ Auth Routes ============

@app.get("/api/debug/raw-items")
async def debug_raw_items():
    """Debug: Show raw items from Zoho (no auth required)"""
    try:
        # Fetch 500 items to get a good sample of brands
        all_items = []
        for page in range(1, 6):  # 5 pages of 100 = 500 items
            response = await zoho_api.get_items(page=page, per_page=100)
            items = response.get("items", [])
            all_items.extend(items)
            if len(items) < 100:
                break
        
        # Collect unique brand values
        brands = set()
        manufacturers = set()
        for item in all_items:
            if item.get("brand"):
                brands.add(item.get("brand"))
            if item.get("manufacturer"):
                manufacturers.add(item.get("manufacturer"))
        
        return {
            "total_items_fetched": len(all_items),
            "unique_brands": sorted(list(brands)),
            "unique_manufacturers": sorted(list(manufacturers)),
            "sample_items": [
                {
                    "name": item.get("name"),
                    "sku": item.get("sku"),
                    "brand": item.get("brand"),
                    "manufacturer": item.get("manufacturer")
                }
                for item in all_items[:10]
            ]
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/api/debug/find-brand/{brand_name}")
async def debug_find_brand(brand_name: str):
    """Debug: Search for items containing a brand name"""
    try:
        all_items = []
        for page in range(1, 11):  # 10 pages
            response = await zoho_api.get_items(page=page, per_page=100)
            items = response.get("items", [])
            all_items.extend(items)
            if len(items) < 100:
                break
        
        # Find items matching the brand
        matching = []
        brand_lower = brand_name.lower()
        for item in all_items:
            item_brand = (item.get("brand") or "").lower()
            item_manufacturer = (item.get("manufacturer") or "").lower()
            item_name = (item.get("name") or "").lower()
            
            if brand_lower in item_brand or brand_lower in item_manufacturer or brand_lower in item_name:
                matching.append({
                    "name": item.get("name"),
                    "sku": item.get("sku"),
                    "brand": item.get("brand"),
                    "manufacturer": item.get("manufacturer")
                })
        
        return {
            "search_term": brand_name,
            "total_items_searched": len(all_items),
            "matches_found": len(matching),
            "matching_items": matching[:20]
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/api/debug/search/{search_term}")
async def debug_search(search_term: str):
    """Debug: Use Zoho's search API directly"""
    try:
        response = await zoho_api.get_items(page=1, per_page=100, search=search_term)
        items = response.get("items", [])
        
        return {
            "search_term": search_term,
            "results_count": len(items),
            "items": [
                {
                    "name": item.get("name"),
                    "sku": item.get("sku"),
                    "brand": item.get("brand"),
                    "manufacturer": item.get("manufacturer"),
                    "status": item.get("status")
                }
                for item in items[:20]
            ]
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/api/debug/products-flow")
async def debug_products_flow():
    """Debug: Show exactly what the products endpoint does for Kate's brands"""
    try:
        # Simulate Kate's brands
        kate_brands = ["Remember", "Räder", "My Flame", "Ideas4Seasons"]
        brand_search_terms = get_all_brand_patterns(kate_brands)
        
        results = {
            "kate_brands": kate_brands,
            "brand_search_terms": brand_search_terms,
            "search_results": {}
        }
        
        seen_ids = set()
        all_items = []
        
        for brand_term in brand_search_terms:
            response = await zoho_api.get_items(page=1, per_page=50, search=brand_term)
            brand_items = response.get("items", [])
            
            results["search_results"][brand_term] = {
                "count": len(brand_items),
                "sample": [item.get("name") for item in brand_items[:3]]
            }
            
            for item in brand_items:
                item_id = item.get("item_id")
                if item_id not in seen_ids:
                    seen_ids.add(item_id)
                    all_items.append(item)
        
        # Filter
        filtered = filter_items_by_brand(all_items, kate_brands)
        
        results["total_unique_items"] = len(all_items)
        results["after_filter"] = len(filtered)
        results["sample_filtered"] = [item.get("name") for item in filtered[:10]]
        
        return results
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/api/debug/brands")
async def debug_brands(agent: TokenData = Depends(get_current_agent)):
    """Debug: Show unique brand values from Zoho items"""
    try:
        response = await zoho_api.get_items(page=1, per_page=200)
        items = response.get("items", [])
        
        # Collect all unique values from brand-related fields
        brands_found = set()
        sample_items = []
        
        for item in items[:50]:  # First 50 items
            # Get ALL keys from the item to see what fields exist
            all_keys = list(item.keys())
            
            brand = item.get("brand") or ""
            manufacturer = item.get("manufacturer") or ""
            cf_brand = item.get("cf_brand") or ""
            group_name = item.get("group_name") or ""
            category_name = item.get("category_name") or ""
            
            if brand: brands_found.add(f"brand: {brand}")
            if manufacturer: brands_found.add(f"manufacturer: {manufacturer}")
            if cf_brand: brands_found.add(f"cf_brand: {cf_brand}")
            if group_name: brands_found.add(f"group_name: {group_name}")
            if category_name: brands_found.add(f"category_name: {category_name}")
            
            sample_items.append({
                "name": item.get("name"),
                "sku": item.get("sku"),
                "all_keys": all_keys,
                "brand": brand,
                "manufacturer": manufacturer,
                "cf_brand": cf_brand,
                "group_name": group_name,
                "category_name": category_name,
                "raw_item": item  # Include full raw data
            })
        
        return {
            "agent_brands": agent.brands,
            "total_items": len(items),
            "unique_values_found": sorted(list(brands_found)),
            "sample_items": sample_items[:5]  # Just 5 items with full data
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Agent login with ID and PIN"""
    if not verify_agent_pin(request.agent_id, request.pin):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid agent ID or PIN"
        )
    
    agent = get_agent(request.agent_id)
    brands = get_agent_brands(request.agent_id)
    
    token = create_access_token({
        "sub": request.agent_id,
        "agent_name": agent["name"],
        "brands": brands
    })
    
    return LoginResponse(
        access_token=token,
        agent_name=agent["name"],
        brands=brands
    )


@app.get("/api/auth/me")
async def get_me(agent: TokenData = Depends(get_current_agent)):
    """Get current agent info"""
    return {
        "agent_id": agent.agent_id,
        "agent_name": agent.agent_name,
        "brands": agent.brands
    }


# ============ Products Routes ============

def filter_items_by_brand(items: List, brands: List[str]) -> List:
    """Filter items to only those matching agent's brands"""
    # Get all brand variations (e.g., "Paper Products Design" -> ["Paper Products Design", "ppd PAPERPRODUCTS DESIGN GmbH", etc.])
    all_patterns = get_all_brand_patterns(brands)
    
    filtered = []
    brand_patterns = [re.compile(re.escape(b), re.IGNORECASE) for b in all_patterns]
    
    for item in items:
        item_brand = item.get("brand") or ""
        item_manufacturer = item.get("manufacturer") or ""
        item_cf_brand = item.get("cf_brand") or ""
        # Also check item group or category if brand field isn't set
        item_group = item.get("group_name") or item.get("category_name") or ""
        
        # Check all text fields against all brand patterns
        all_text = f"{item_brand} {item_manufacturer} {item_cf_brand} {item_group}"
        
        for pattern in brand_patterns:
            if pattern.search(all_text):
                filtered.append(item)
                break
    
    return filtered


@app.get("/api/products")
async def get_products(
    page: int = 1,
    search: Optional[str] = None,
    brand: Optional[str] = None,
    agent: TokenData = Depends(get_current_agent)
):
    """Get products filtered by agent's brands"""
    try:
        items = []
        has_more = False
        
        print(f"DEBUG: page={page}, search={search}, brand={brand}, agent.brands={agent.brands}")
        
        if search:
            # User is searching - use their search term
            response = await zoho_api.get_items(page=page, search=search)
            items = response.get("items", [])
            has_more = response.get("page_context", {}).get("has_more_page", False)
            print(f"DEBUG: Search returned {len(items)} items")
            # Filter by selected brand if specified, otherwise by agent's brands
            filter_brands = [brand] if brand else agent.brands
            items = filter_items_by_brand(items, filter_brands)
            print(f"DEBUG: After filter by {filter_brands}: {len(items)} items")
        elif brand:
            # User selected a specific brand - search for it using variations
            brand_patterns = get_all_brand_patterns([brand])
            print(f"DEBUG: Brand filter '{brand}' -> patterns: {brand_patterns}")
            
            seen_ids = set()
            for brand_term in brand_patterns:
                response = await zoho_api.get_items(page=1, per_page=100, search=brand_term)
                brand_items = response.get("items", [])
                print(f"DEBUG: Search '{brand_term}' returned {len(brand_items)} items")
                
                for item in brand_items:
                    item_id = item.get("item_id")
                    if item_id not in seen_ids:
                        seen_ids.add(item_id)
                        items.append(item)
            
            print(f"DEBUG: Total unique items: {len(items)}")
            # Filter to make sure it's actually that brand
            items = filter_items_by_brand(items, [brand])
            print(f"DEBUG: After filter: {len(items)} items")
            
            # Paginate
            per_page = 30
            start = (page - 1) * per_page
            end = start + per_page
            has_more = end < len(items)
            items = items[start:end]
        else:
            # No search - fetch products for each of agent's brands
            brand_search_terms = get_all_brand_patterns(agent.brands)
            seen_ids = set()
            
            for brand_term in brand_search_terms:
                response = await zoho_api.get_items(page=1, per_page=50, search=brand_term)
                brand_items = response.get("items", [])
                
                for item in brand_items:
                    item_id = item.get("item_id")
                    if item_id not in seen_ids:
                        seen_ids.add(item_id)
                        items.append(item)
            
            # Filter to ensure only agent's brands
            items = filter_items_by_brand(items, agent.brands)
            # Sort by name
            items.sort(key=lambda x: x.get("name", ""))
            
            # Paginate the combined results
            per_page = 30
            start = (page - 1) * per_page
            end = start + per_page
            has_more = end < len(items)
            items = items[start:end]
        
        # Transform for frontend (only include selling price, not purchase price)
        products = []
        for item in items:
            sku = item.get("sku", "")
            products.append({
                "item_id": item.get("item_id"),
                "name": item.get("name"),
                "sku": sku,
                "description": item.get("description", ""),
                "rate": item.get("rate", 0),  # Selling price
                "stock_on_hand": item.get("stock_on_hand", 0),
                "image_url": item.get("image_url") or item.get("image_document_id"),
                "brand": item.get("brand") or item.get("manufacturer") or item.get("cf_brand") or item.get("group_name", ""),
                "unit": item.get("unit", "pcs"),
                "status": item.get("status", "active"),
                "pack_qty": _pack_quantities.get(sku)
            })
        
        return {
            "products": products,
            "page": page,
            "has_more": has_more
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/products/{item_id}")
async def get_product(
    item_id: str,
    agent: TokenData = Depends(get_current_agent)
):
    """Get a single product with current stock"""
    try:
        response = await zoho_api.get_item(item_id)
        item = response.get("item", {})
        
        return {
            "item_id": item.get("item_id"),
            "name": item.get("name"),
            "sku": item.get("sku"),
            "description": item.get("description", ""),
            "rate": item.get("rate", 0),
            "stock_on_hand": item.get("stock_on_hand", 0),
            "image_url": item.get("image_url"),
            "brand": item.get("brand") or item.get("manufacturer") or item.get("cf_brand", ""),
            "unit": item.get("unit", "pcs")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Product Images ============

@app.get("/api/products/{item_id}/image")
async def get_product_image(item_id: str):
    """Get product image - proxied through backend for auth"""
    try:
        print(f"DEBUG: Image request for item_id={item_id}")
        image_data = await zoho_api.get_item_image(item_id)
        if image_data:
            print(f"DEBUG: Got image data, size={len(image_data)} bytes")
            return Response(content=image_data, media_type="image/jpeg")
        else:
            print(f"DEBUG: No image data returned for {item_id}")
            raise HTTPException(status_code=404, detail="Image not found")
    except Exception as e:
        print(f"DEBUG: Image error for {item_id}: {e}")
        raise HTTPException(status_code=404, detail="Image not found")


# ============ Customers Routes ============

@app.get("/api/customers")
async def get_customers(
    page: int = 1,
    search: Optional[str] = None,
    agent: TokenData = Depends(get_current_agent)
):
    """Get customers"""
    try:
        # If searching, fetch multiple pages to search through more customers
        if search:
            all_contacts = []
            for p in range(1, 6):  # Fetch up to 5 pages (1000 customers)
                response = await zoho_api.get_contacts(page=p)
                contacts = response.get("contacts", [])
                all_contacts.extend(contacts)
                if not response.get("page_context", {}).get("has_more_page", False):
                    break
            
            search_lower = search.lower()
            contacts = [
                c for c in all_contacts
                if search_lower in (c.get("company_name") or "").lower()
                or search_lower in (c.get("contact_name") or "").lower()
                or search_lower in (c.get("email") or "").lower()
            ]
            has_more = False
        else:
            response = await zoho_api.get_contacts(page=page)
            contacts = response.get("contacts", [])
            has_more = response.get("page_context", {}).get("has_more_page", False)
        
        customers = []
        for contact in contacts:
            customers.append({
                "contact_id": contact.get("contact_id"),
                "company_name": contact.get("company_name") or contact.get("contact_name"),
                "contact_name": contact.get("contact_name"),
                "email": contact.get("email"),
                "phone": contact.get("phone"),
                "outstanding": contact.get("outstanding_receivable_amount", 0)
            })
        
        return {
            "customers": customers,
            "page": page,
            "has_more": has_more
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/customers")
async def create_customer(
    customer: CustomerCreate,
    agent: TokenData = Depends(get_current_agent)
):
    """Create a new customer"""
    try:
        contact_data = {
            "contact_name": customer.company_name,
            "company_name": customer.company_name,
            "contact_type": "customer",
            "notes": f"Created by {agent.agent_name} via Sales App"
        }
        
        if customer.contact_name:
            contact_data["contact_persons"] = [{
                "first_name": customer.contact_name.split()[0] if customer.contact_name else "",
                "last_name": " ".join(customer.contact_name.split()[1:]) if customer.contact_name and len(customer.contact_name.split()) > 1 else "",
                "email": customer.email,
                "phone": customer.phone,
                "is_primary_contact": True
            }]
        
        if customer.email:
            contact_data["email"] = customer.email
        if customer.phone:
            contact_data["phone"] = customer.phone
        if customer.billing_address:
            contact_data["billing_address"] = customer.billing_address
        
        response = await zoho_api.create_contact(contact_data)
        contact = response.get("contact", {})
        
        return {
            "contact_id": contact.get("contact_id"),
            "company_name": contact.get("company_name"),
            "contact_name": contact.get("contact_name"),
            "message": "Customer created successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Orders Routes ============

@app.post("/api/orders")
async def create_order(
    order: OrderCreate,
    agent: TokenData = Depends(get_current_agent)
):
    """Create a new sales order"""
    try:
        # Build line items for Zoho - only include fields Zoho expects
        line_items = []
        for item in order.line_items:
            line_item = {
                "item_id": item.item_id,
                "quantity": item.quantity,
                "rate": item.rate
            }
            if item.discount_percent > 0:
                line_item["discount"] = item.discount_percent
            line_items.append(line_item)
        
        order_data = {
            "customer_id": order.customer_id,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "line_items": line_items,
            "notes": f"Order placed by {agent.agent_name}\n{order.notes or ''}".strip()
        }
        
        if order.reference_number:
            order_data["reference_number"] = order.reference_number
        
        print(f"ORDER DEBUG: Sending to Zoho: {order_data}")
        
        response = await zoho_api.create_sales_order(order_data)
        salesorder = response.get("salesorder", {})
        
        return {
            "salesorder_id": salesorder.get("salesorder_id"),
            "salesorder_number": salesorder.get("salesorder_number"),
            "total": salesorder.get("total"),
            "status": salesorder.get("status"),
            "message": "Order created successfully"
        }
    except Exception as e:
        print(f"ORDER ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/orders")
async def get_orders(
    page: int = 1,
    customer_id: Optional[str] = None,
    agent: TokenData = Depends(get_current_agent)
):
    """Get recent sales orders"""
    try:
        response = await zoho_api.get_sales_orders(page=page, customer_id=customer_id)
        orders = response.get("salesorders", [])
        
        return {
            "orders": [{
                "salesorder_id": o.get("salesorder_id"),
                "salesorder_number": o.get("salesorder_number"),
                "customer_name": o.get("customer_name"),
                "date": o.get("date"),
                "total": o.get("total"),
                "status": o.get("status")
            } for o in orders],
            "page": page,
            "has_more": response.get("page_context", {}).get("has_more_page", False)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/orders/{salesorder_id}")
async def get_order(
    salesorder_id: str,
    agent: TokenData = Depends(get_current_agent)
):
    """Get a single order with full details"""
    try:
        response = await zoho_api.get_sales_order(salesorder_id)
        return response.get("salesorder", {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Health Check ============

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ============ Static Files (Production) ============

# Serve frontend static files in production
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    # Mount static assets (js, css, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")
    
    # Serve index.html for all non-API routes (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        
        # Serve static files if they exist
        file_path = os.path.join(static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Otherwise serve index.html for SPA routing
        return FileResponse(os.path.join(static_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
