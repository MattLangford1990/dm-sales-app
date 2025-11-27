from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timedelta
from jose import JWTError, jwt
from typing import Optional, List, Dict
import re
import os
import io

import json
from config import get_settings
from agents import get_agent, get_agent_brands, verify_agent_pin, list_agents, get_all_brand_patterns, is_admin, list_all_agents_admin, create_agent, update_agent, delete_agent, get_all_brands
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
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    booking_requirements: Optional[str] = None
    payment_terms: Optional[str] = None


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
        "brands": agent.brands,
        "is_admin": is_admin(agent.agent_id)
    }


# ============ Admin Routes ============

class AgentCreate(BaseModel):
    agent_id: str
    name: str
    pin: str
    brands: List[str]
    commission_rate: float = 0.125

class AgentUpdate(BaseModel):
    name: Optional[str] = None
    pin: Optional[str] = None
    brands: Optional[List[str]] = None
    commission_rate: Optional[float] = None
    active: Optional[bool] = None


def require_admin(agent: TokenData = Depends(get_current_agent)) -> TokenData:
    """Dependency that requires admin access"""
    if not is_admin(agent.agent_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return agent


@app.get("/api/admin/agents")
async def admin_list_agents(agent: TokenData = Depends(require_admin)):
    """List all agents with full details (admin only)"""
    return {
        "agents": list_all_agents_admin(),
        "available_brands": get_all_brands()
    }


@app.post("/api/admin/agents")
async def admin_create_agent(
    new_agent: AgentCreate,
    agent: TokenData = Depends(require_admin)
):
    """Create a new agent (admin only)"""
    try:
        created = create_agent(
            agent_id=new_agent.agent_id,
            name=new_agent.name,
            pin=new_agent.pin,
            brands=new_agent.brands,
            commission_rate=new_agent.commission_rate
        )
        return {"message": "Agent created successfully", "agent_id": new_agent.agent_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/admin/agents/{agent_id}")
async def admin_update_agent(
    agent_id: str,
    updates: AgentUpdate,
    agent: TokenData = Depends(require_admin)
):
    """Update an agent (admin only)"""
    try:
        # Convert to dict, excluding None values
        update_dict = {k: v for k, v in updates.dict().items() if v is not None}
        updated = update_agent(agent_id, update_dict)
        return {"message": "Agent updated successfully", "agent_id": agent_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/admin/agents/{agent_id}")
async def admin_delete_agent(
    agent_id: str,
    agent: TokenData = Depends(require_admin)
):
    """Delete or deactivate an agent (admin only)"""
    try:
        delete_agent(agent_id)
        return {"message": "Agent deleted successfully", "agent_id": agent_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/admin/stats")
async def admin_get_stats(agent: TokenData = Depends(require_admin)):
    """Get admin dashboard stats (admin only)"""
    try:
        # Get recent orders for stats
        response = await zoho_api.get_sales_orders(page=1)
        orders = response.get("salesorders", [])
        
        # Calculate stats
        today = datetime.now().strftime("%Y-%m-%d")
        orders_today = [o for o in orders if o.get("date") == today]
        
        # Get orders by agent (from notes)
        agents_list = list_all_agents_admin()
        orders_by_agent = {}
        for a in agents_list:
            agent_name = a["name"]
            count = len([o for o in orders if f"Order placed by {agent_name}" in (o.get("notes") or "")])
            if count > 0:
                orders_by_agent[agent_name] = count
        
        return {
            "total_agents": len(agents_list),
            "active_agents": len([a for a in agents_list if a.get("active", True)]),
            "orders_today": len(orders_today),
            "orders_today_value": sum(o.get("total", 0) for o in orders_today),
            "recent_orders": len(orders),
            "orders_by_agent": orders_by_agent
        }
    except Exception as e:
        print(f"ADMIN STATS ERROR: {e}")
        return {
            "total_agents": len(list_all_agents_admin()),
            "active_agents": len([a for a in list_all_agents_admin() if a.get("active", True)]),
            "orders_today": 0,
            "orders_today_value": 0,
            "recent_orders": 0,
            "orders_by_agent": {}
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


@app.get("/api/products/sync")
async def sync_products(
    agent: TokenData = Depends(get_current_agent)
):
    """Get ALL products for offline sync - no pagination"""
    try:
        print(f"SYNC: Starting product sync for {agent.agent_name}")
        
        # Get all brand patterns for this agent
        brand_patterns = get_all_brand_patterns(agent.brands)
        seen_ids = set()
        all_items = []
        
        # Fetch products for each brand pattern
        for brand_term in brand_patterns:
            page = 1
            while True:
                response = await zoho_api.get_items(page=page, per_page=200, search=brand_term)
                items = response.get("items", [])
                
                for item in items:
                    item_id = item.get("item_id")
                    if item_id not in seen_ids and item.get("status") != "inactive":
                        seen_ids.add(item_id)
                        all_items.append(item)
                
                if not response.get("page_context", {}).get("has_more_page", False):
                    break
                page += 1
                if page > 20:  # Safety limit per brand
                    break
        
        # Filter to ensure only agent's brands
        all_items = filter_items_by_brand(all_items, agent.brands)
        
        # Sort by SKU alphabetically
        all_items.sort(key=lambda x: (x.get("sku") or "").upper())
        
        # Transform for frontend
        products = []
        for item in all_items:
            sku = item.get("sku", "")
            products.append({
                "item_id": item.get("item_id"),
                "name": item.get("name"),
                "sku": sku,
                "ean": item.get("ean") or item.get("upc") or "",
                "description": item.get("description", ""),
                "rate": item.get("rate", 0),
                "stock_on_hand": item.get("stock_on_hand", 0),
                "brand": item.get("brand") or item.get("manufacturer") or "",
                "unit": item.get("unit", "pcs"),
                "pack_qty": _pack_quantities.get(sku)
            })
        
        print(f"SYNC: Returning {len(products)} products")
        
        return {
            "products": products,
            "total": len(products),
            "synced_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"SYNC ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/products/stock")
async def get_stock_levels(
    agent: TokenData = Depends(get_current_agent)
):
    """Get lightweight stock levels only - for periodic refresh (~50KB vs 1MB)"""
    try:
        print(f"STOCK: Getting stock levels for {agent.agent_name}")
        
        # Get all brand patterns for this agent
        brand_patterns = get_all_brand_patterns(agent.brands)
        seen_ids = set()
        stock_data = []
        
        # Fetch products for each brand pattern
        for brand_term in brand_patterns:
            page = 1
            while True:
                response = await zoho_api.get_items(page=page, per_page=200, search=brand_term)
                items = response.get("items", [])
                
                for item in items:
                    item_id = item.get("item_id")
                    if item_id not in seen_ids and item.get("status") != "inactive":
                        seen_ids.add(item_id)
                        stock_data.append({
                            "item_id": item_id,
                            "sku": item.get("sku"),
                            "stock_on_hand": item.get("stock_on_hand", 0)
                        })
                
                if not response.get("page_context", {}).get("has_more_page", False):
                    break
                page += 1
                if page > 20:
                    break
        
        print(f"STOCK: Returning {len(stock_data)} stock levels")
        
        return {
            "stock": stock_data,
            "updated_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"STOCK ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/customers/sync")
async def sync_customers(
    agent: TokenData = Depends(get_current_agent)
):
    """Get ALL customers for offline sync - no pagination"""
    try:
        print(f"SYNC: Starting customer sync for {agent.agent_name}")
        
        all_contacts = []
        page = 1
        
        while True:
            response = await zoho_api.get_contacts(page=page, per_page=200)
            contacts = response.get("contacts", [])
            all_contacts.extend(contacts)
            
            if not response.get("page_context", {}).get("has_more_page", False):
                break
            page += 1
            if page > 50:  # Safety limit
                break
        
        customers = [{
            "contact_id": c.get("contact_id"),
            "company_name": c.get("company_name") or c.get("contact_name"),
            "contact_name": c.get("contact_name"),
            "email": c.get("email"),
            "phone": c.get("phone")
        } for c in all_contacts]
        
        print(f"SYNC: Returning {len(customers)} customers")
        
        return {
            "customers": customers,
            "total": len(customers),
            "synced_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"SYNC ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
            # Sort by SKU alphabetically
            items.sort(key=lambda x: (x.get("sku") or "").upper())
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
            
            # Sort by SKU alphabetically
            items.sort(key=lambda x: (x.get("sku") or "").upper())
            
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
            # Sort by SKU alphabetically
            items.sort(key=lambda x: (x.get("sku") or "").upper())
            
            # Paginate the combined results
            per_page = 30
            start = (page - 1) * per_page
            end = start + per_page
            has_more = end < len(items)
            items = items[start:end]
        
        # Transform for frontend (only include selling price, not purchase price)
        # Filter out inactive items
        products = []
        for item in items:
            # Skip inactive items
            if item.get("status") == "inactive":
                continue
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

# Image cache - stores image bytes in memory
_image_cache = {}
_image_cache_max_size = 500  # Max number of images to cache

@app.get("/api/products/{item_id}/image")
async def get_product_image(item_id: str):
    """Get product image - cached for performance"""
    global _image_cache
    
    # Check cache first
    if item_id in _image_cache:
        image_data = _image_cache[item_id]
        if image_data:
            return Response(
                content=image_data, 
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "public, max-age=86400",  # Browser caches for 24 hours
                    "ETag": f'"{item_id}"'
                }
            )
        else:
            raise HTTPException(status_code=404, detail="Image not found")
    
    try:
        image_data = await zoho_api.get_item_image(item_id)
        
        # Store in cache (limit size)
        if len(_image_cache) >= _image_cache_max_size:
            # Remove oldest entries (first 100)
            keys_to_remove = list(_image_cache.keys())[:100]
            for key in keys_to_remove:
                del _image_cache[key]
        
        _image_cache[item_id] = image_data
        
        if image_data:
            return Response(
                content=image_data, 
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "ETag": f'"{item_id}"'
                }
            )
        else:
            raise HTTPException(status_code=404, detail="Image not found")
    except Exception as e:
        # Cache the failure too to avoid repeated lookups
        _image_cache[item_id] = None
        raise HTTPException(status_code=404, detail="Image not found")


@app.get("/api/barcode/{barcode}")
async def lookup_barcode(
    barcode: str,
    agent: TokenData = Depends(get_current_agent)
):
    """Look up a product by EAN/barcode - fast direct search"""
    try:
        print(f"BARCODE: Looking up {barcode}")
        
        # Search Zoho directly for the barcode (searches across SKU, EAN, name, etc.)
        response = await zoho_api.get_items(page=1, per_page=20, search=barcode)
        items = response.get("items", [])
        
        # Look for exact match on EAN, UPC, or SKU
        for item in items:
            item_ean = item.get("ean") or item.get("upc") or ""
            item_sku = item.get("sku") or ""
            
            if (item_ean == barcode or item_sku.upper() == barcode.upper()):
                if item.get("status") == "inactive":
                    return {"found": False, "message": "Product is inactive"}
                
                sku = item.get("sku", "")
                print(f"BARCODE: Found {item.get('name')}")
                return {
                    "found": True,
                    "product": {
                        "item_id": item.get("item_id"),
                        "name": item.get("name"),
                        "sku": sku,
                        "ean": item_ean or barcode,
                        "description": item.get("description", ""),
                        "rate": item.get("rate", 0),
                        "stock_on_hand": item.get("stock_on_hand", 0),
                        "brand": item.get("brand") or item.get("manufacturer") or "",
                        "unit": item.get("unit", "pcs"),
                        "pack_qty": _pack_quantities.get(sku)
                    }
                }
        
        print(f"BARCODE: Not found: {barcode}")
        return {"found": False, "message": "Product not found"}
        
    except Exception as e:
        print(f"BARCODE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
        # Build notes with all the additional info
        notes_parts = [f"Created by {agent.agent_name} via Sales App"]
        if customer.billing_address:
            notes_parts.append(f"\nBilling Address:\n{customer.billing_address}")
        if customer.shipping_address:
            notes_parts.append(f"\nShipping Address:\n{customer.shipping_address}")
        if customer.booking_requirements:
            notes_parts.append(f"\nBooking In Requirements:\n{customer.booking_requirements}")
        if customer.payment_terms:
            notes_parts.append(f"\nPayment Terms: {customer.payment_terms}")
        
        contact_data = {
            "contact_name": customer.company_name,
            "company_name": customer.company_name,
            "contact_type": "customer",
            "notes": "\n".join(notes_parts)
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
        
        # Set billing address as structured data if Zoho supports it
        if customer.billing_address:
            contact_data["billing_address"] = {
                "address": customer.billing_address
            }
        if customer.shipping_address:
            contact_data["shipping_address"] = {
                "address": customer.shipping_address
            }
        
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
        error_msg = str(e)
        # Extract Zoho's error message if present
        if "Inactive items" in error_msg:
            error_msg = "Some items in your cart are no longer available. Please clear your cart and try again."
        print(f"ORDER ERROR: {e}")
        raise HTTPException(status_code=500, detail=error_msg)


@app.get("/api/orders")
async def get_orders(
    page: int = 1,
    customer_id: Optional[str] = None,
    agent: TokenData = Depends(get_current_agent)
):
    """Get recent sales orders - filtered by agent unless admin"""
    try:
        # Fetch more orders if we need to filter
        if is_admin(agent.agent_id):
            # Admins see all orders
            response = await zoho_api.get_sales_orders(page=page, customer_id=customer_id)
            orders = response.get("salesorders", [])
            has_more = response.get("page_context", {}).get("has_more_page", False)
        else:
            # Non-admins only see their own orders
            # Need to fetch more and filter since Zoho doesn't filter by notes
            all_orders = []
            current_page = 1
            while len(all_orders) < 200:  # Safety limit
                response = await zoho_api.get_sales_orders(page=current_page, customer_id=customer_id)
                page_orders = response.get("salesorders", [])
                if not page_orders:
                    break
                all_orders.extend(page_orders)
                if not response.get("page_context", {}).get("has_more_page", False):
                    break
                current_page += 1
            
            # Filter to only orders placed by this agent
            # Orders have notes like "Order placed by Kate\n..."
            agent_orders = [
                o for o in all_orders
                if f"Order placed by {agent.agent_name}" in (o.get("notes") or "")
            ]
            
            # Paginate the filtered results
            per_page = 20
            start = (page - 1) * per_page
            end = start + per_page
            orders = agent_orders[start:end]
            has_more = end < len(agent_orders)
        
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
            "has_more": has_more
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/orders/{salesorder_id}")
async def get_order(
    salesorder_id: str,
    agent: TokenData = Depends(get_current_agent)
):
    """Get a single order with full details - only if agent has permission"""
    try:
        response = await zoho_api.get_sales_order(salesorder_id)
        order = response.get("salesorder", {})
        
        # Check permission - admins can see all, others only their own
        if not is_admin(agent.agent_id):
            notes = order.get("notes") or ""
            if f"Order placed by {agent.agent_name}" not in notes:
                raise HTTPException(status_code=403, detail="You don't have permission to view this order")
        
        return order
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Export Quote ============

class ExportItem(BaseModel):
    item_id: str
    name: str
    sku: str
    ean: Optional[str] = None
    rate: float
    quantity: int

class ExportRequest(BaseModel):
    items: List[ExportItem]
    customer_name: Optional[str] = None

@app.post("/api/export/quote")
async def export_quote(
    request: ExportRequest,
    agent: TokenData = Depends(get_current_agent)
):
    """Export cart as Excel quote with images"""
    try:
        from openpyxl import Workbook
        from openpyxl.drawing.image import Image as XLImage
        from openpyxl.utils import get_column_letter
        from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
        from PIL import Image
        
        wb = Workbook()
        ws = wb.active
        ws.title = "Quote"
        
        # Set up header style
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        # Set column widths
        ws.column_dimensions['A'].width = 15  # Image
        ws.column_dimensions['B'].width = 40  # Description
        ws.column_dimensions['C'].width = 15  # SKU
        ws.column_dimensions['D'].width = 18  # EAN
        ws.column_dimensions['E'].width = 10  # Qty
        ws.column_dimensions['F'].width = 12  # Price
        ws.column_dimensions['G'].width = 12  # Total
        
        # Add title
        if request.customer_name:
            ws.merge_cells('A1:G1')
            ws['A1'] = f"Quote for {request.customer_name}"
            ws['A1'].font = Font(bold=True, size=14)
            ws['A1'].alignment = Alignment(horizontal="center")
            start_row = 3
        else:
            start_row = 1
        
        # Add headers
        headers = ['Image', 'Description', 'SKU', 'EAN', 'Qty', 'Unit Price', 'Total']
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=start_row, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border
        
        ws.row_dimensions[start_row].height = 25
        
        # Add items
        current_row = start_row + 1
        grand_total = 0
        
        for item in request.items:
            # Set row height for image
            ws.row_dimensions[current_row].height = 75
            
            # Try to fetch and add image
            try:
                image_data = await zoho_api.get_item_image(item.item_id)
                if image_data:
                    # Convert to PIL Image and resize
                    img = Image.open(io.BytesIO(image_data))
                    img.thumbnail((90, 90), Image.Resampling.LANCZOS)
                    
                    # Save to bytes
                    img_bytes = io.BytesIO()
                    img.save(img_bytes, format='PNG')
                    img_bytes.seek(0)
                    
                    # Add to Excel
                    xl_img = XLImage(img_bytes)
                    xl_img.width = 90
                    xl_img.height = 90
                    ws.add_image(xl_img, f'A{current_row}')
            except Exception as img_err:
                print(f"IMAGE EXPORT ERROR: {img_err}")
            
            # Add item details
            line_total = item.rate * item.quantity
            grand_total += line_total
            
            ws.cell(row=current_row, column=2, value=item.name).border = thin_border
            ws.cell(row=current_row, column=3, value=item.sku).border = thin_border
            ws.cell(row=current_row, column=4, value=item.ean or '').border = thin_border
            ws.cell(row=current_row, column=5, value=item.quantity).border = thin_border
            ws.cell(row=current_row, column=5).alignment = Alignment(horizontal="center")
            
            price_cell = ws.cell(row=current_row, column=6, value=item.rate)
            price_cell.number_format = '£#,##0.00'
            price_cell.border = thin_border
            
            total_cell = ws.cell(row=current_row, column=7, value=line_total)
            total_cell.number_format = '£#,##0.00'
            total_cell.border = thin_border
            
            # Center align
            for col in [3, 4]:
                ws.cell(row=current_row, column=col).alignment = Alignment(horizontal="center")
            
            current_row += 1
        
        # Add grand total
        current_row += 1
        ws.cell(row=current_row, column=6, value="TOTAL:").font = Font(bold=True)
        total_cell = ws.cell(row=current_row, column=7, value=grand_total)
        total_cell.font = Font(bold=True)
        total_cell.number_format = '£#,##0.00'
        
        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        # Generate filename
        date_str = datetime.now().strftime("%Y%m%d")
        customer_part = request.customer_name.replace(' ', '_')[:20] if request.customer_name else 'Quote'
        filename = f"{customer_part}_{date_str}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        print(f"EXPORT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Health Check ============

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/debug/pack-qty/{sku}")
async def debug_pack_qty(sku: str):
    """Debug: Check pack quantity for a SKU"""
    return {
        "sku": sku,
        "pack_qty": _pack_quantities.get(sku),
        "total_pack_qtys_loaded": len(_pack_quantities),
        "sample_keys": list(_pack_quantities.keys())[:10]
    }


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
