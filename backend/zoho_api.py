import httpx
import asyncio
from datetime import datetime, timedelta
from config import get_settings

settings = get_settings()

# Token cache
_token_cache = {
    "access_token": None,
    "expires_at": None
}

# ============ PRODUCT CACHE (reduces API calls significantly) ============
# Caches ALL items from Zoho for 30 minutes
_all_items_cache = {
    "items": None,
    "cached_at": None
}
ALL_ITEMS_CACHE_TTL = timedelta(minutes=30)  # Refresh every 30 minutes
_cache_lock = asyncio.Lock()  # Prevent concurrent cache refreshes

async def get_all_items_cached() -> list:
    """Get all items from Zoho with caching - dramatically reduces API calls"""
    global _all_items_cache
    now = datetime.now()
    
    # Return cached items if still valid
    if _all_items_cache["items"] and _all_items_cache["cached_at"]:
        age = now - _all_items_cache["cached_at"]
        if age < ALL_ITEMS_CACHE_TTL:
            return _all_items_cache["items"]
    
    # Use lock to prevent multiple concurrent fetches
    async with _cache_lock:
        # Double-check after acquiring lock (another request might have populated it)
        if _all_items_cache["items"] and _all_items_cache["cached_at"]:
            age = now - _all_items_cache["cached_at"]
            if age < ALL_ITEMS_CACHE_TTL:
                return _all_items_cache["items"]
        
        # Fetch all items from Zoho
        print("CACHE: Fetching all items from Zoho...")
        all_items = []
        page = 1
        
        while True:
            response = await get_items(page=page, per_page=200)
            items = response.get("items", [])
            all_items.extend(items)
            print(f"CACHE: Fetched page {page}, got {len(items)} items, total: {len(all_items)}")
            
            if not response.get("page_context", {}).get("has_more_page", False):
                break
            page += 1
            if page > 100:  # Safety limit (20,000 items max)
                break
        
        # Update cache
        _all_items_cache["items"] = all_items
        _all_items_cache["cached_at"] = now
        print(f"CACHE: Stored {len(all_items)} items, expires in {ALL_ITEMS_CACHE_TTL}")
        
        return all_items

def invalidate_items_cache():
    """Force refresh of items cache on next request"""
    global _all_items_cache
    _all_items_cache["items"] = None
    _all_items_cache["cached_at"] = None
    print("CACHE: Items cache invalidated")

# Image cache - LIMITED size to prevent memory issues
# Uses simple LRU-style eviction
_image_cache = {}  # {item_id: bytes}
_image_cache_order = []  # Track order for LRU eviction
IMAGE_CACHE_MAX_COUNT = 100  # Max 100 images (~20MB worst case)
_no_image_cache = set()  # Set of item_ids with no image

# Document ID cache - stores {item_id: image_document_id}
# Populated when items are fetched via list endpoint
_doc_id_cache = {}

# Rate limiting for image requests
_image_request_semaphore = asyncio.Semaphore(5)  # Max 5 concurrent image requests


async def get_access_token() -> str:
    """Get a valid access token, refreshing if necessary"""
    now = datetime.now()
    
    # Return cached token if still valid (with 5 min buffer)
    if _token_cache["access_token"] and _token_cache["expires_at"]:
        if now < _token_cache["expires_at"] - timedelta(minutes=5):
            return _token_cache["access_token"]
    
    # Refresh the token
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://accounts.zoho.eu/oauth/v2/token",
            params={
                "refresh_token": settings.zoho_refresh_token,
                "client_id": settings.zoho_client_id,
                "client_secret": settings.zoho_client_secret,
                "grant_type": "refresh_token"
            }
        )
        response.raise_for_status()
        data = response.json()
        
        _token_cache["access_token"] = data["access_token"]
        _token_cache["expires_at"] = now + timedelta(seconds=data.get("expires_in", 3600))
        
        return _token_cache["access_token"]


async def zoho_request(method: str, endpoint: str, **kwargs) -> dict:
    """Make an authenticated request to Zoho Inventory API"""
    token = await get_access_token()
    
    headers = {
        "Authorization": f"Zoho-oauthtoken {token}",
        "Content-Type": "application/json"
    }
    
    base_url = "https://www.zohoapis.eu/inventory/v1"
    url = f"{base_url}/{endpoint}"
    
    # Add organization_id to params
    params = kwargs.pop("params", {})
    params["organization_id"] = settings.zoho_org_id
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            method,
            url,
            headers=headers,
            params=params,
            **kwargs
        )
        
        # Better error handling - show Zoho's error message
        if not response.is_success:
            error_detail = response.text
            try:
                error_json = response.json()
                error_detail = error_json.get("message", response.text)
            except:
                pass
            print(f"ZOHO ERROR: {response.status_code} - {error_detail}")
            # Raise with Zoho's actual error message
            raise Exception(f"Zoho API Error: {error_detail}")
        
        return response.json()


# ============ Items / Products ============

async def get_items(page: int = 1, per_page: int = 200, search: str = None) -> dict:
    """Get items from Zoho Inventory"""
    params = {
        "page": page,
        "per_page": per_page
    }
    if search:
        params["search_text"] = search
    
    result = await zoho_request("GET", "items", params=params)
    
    # Cache image_document_id for each item (list endpoint has it, single item doesn't)
    for item in result.get("items", []):
        if item.get("image_document_id"):
            _doc_id_cache[item["item_id"]] = item["image_document_id"]
    
    return result


async def get_item(item_id: str) -> dict:
    """Get a single item by ID"""
    return await zoho_request("GET", f"items/{item_id}")


async def get_item_by_ean(ean: str) -> dict:
    """Search for an item by EAN/barcode"""
    # Zoho doesn't have direct EAN search, so we need to fetch items and filter
    # First try searching with the EAN as text
    result = await zoho_request("GET", "items", params={"search_text": ean})
    items = result.get("items", [])
    
    # Look for exact EAN match
    for item in items:
        if item.get("ean") == ean or item.get("upc") == ean:
            return {"item": item, "found": True}
    
    # If not found in search results, the EAN might not be indexed for search
    # We may need to scan through more items
    return {"item": None, "found": False}


async def get_item_stock(item_id: str) -> dict:
    """Get stock levels for an item"""
    return await zoho_request("GET", f"items/{item_id}")


# ============ Customers / Contacts ============

async def get_contacts(page: int = 1, per_page: int = 200, search: str = None) -> dict:
    """Get contacts from Zoho Inventory"""
    params = {
        "page": page,
        "per_page": per_page,
        "contact_type": "customer"
    }
    if search:
        params["search_text"] = search
    
    return await zoho_request("GET", "contacts", params=params)


async def get_contact(contact_id: str) -> dict:
    """Get a single contact by ID"""
    return await zoho_request("GET", f"contacts/{contact_id}")


async def create_contact(contact_data: dict) -> dict:
    """Create a new contact/customer"""
    return await zoho_request("POST", "contacts", json=contact_data)


# ============ Sales Orders ============

async def create_sales_order(order_data: dict) -> dict:
    """Create a new sales order"""
    return await zoho_request("POST", "salesorders", json=order_data)


async def get_sales_orders(page: int = 1, per_page: int = 25, customer_id: str = None) -> dict:
    """Get sales orders"""
    params = {
        "page": page,
        "per_page": per_page,
        "sort_column": "date",
        "sort_order": "D"  # Descending
    }
    if customer_id:
        params["customer_id"] = customer_id
    
    return await zoho_request("GET", "salesorders", params=params)


async def get_sales_order(salesorder_id: str) -> dict:
    """Get a single sales order by ID"""
    return await zoho_request("GET", f"salesorders/{salesorder_id}")


# ============ Images ============

async def get_item_image(item_id: str) -> bytes:
    """Get item image as bytes - with limited LRU cache"""
    global _image_cache, _image_cache_order
    
    # Check memory cache first
    if item_id in _image_cache:
        # Move to end of order list (most recently used)
        if item_id in _image_cache_order:
            _image_cache_order.remove(item_id)
        _image_cache_order.append(item_id)
        return _image_cache[item_id]
    
    # Check if we already know this item has no image
    if item_id in _no_image_cache:
        return None
    
    # Ensure all-items cache is populated (this also populates _doc_id_cache via get_items)
    await get_all_items_cached()
    
    # Check doc_id cache - should now be populated
    doc_id = _doc_id_cache.get(item_id)
    
    if not doc_id:
        # No image for this item - remember this
        _no_image_cache.add(item_id)
        return None
    
    # Use semaphore to limit concurrent requests
    async with _image_request_semaphore:
        # Double-check cache after acquiring semaphore
        if item_id in _image_cache:
            return _image_cache[item_id]
        
        token = await get_access_token()
        headers = {"Authorization": f"Zoho-oauthtoken {token}"}
        params = {"organization_id": settings.zoho_org_id}
        
        # Fetch via documents endpoint
        doc_url = f"https://www.zohoapis.eu/inventory/v1/documents/{doc_id}"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            doc_resp = await client.get(doc_url, headers=headers, params=params)
            
            if doc_resp.status_code == 200 and len(doc_resp.content) > 100:
                image_data = doc_resp.content
                
                # Add to cache with LRU eviction
                if len(_image_cache) >= IMAGE_CACHE_MAX_COUNT:
                    # Remove oldest (first) item
                    if _image_cache_order:
                        oldest = _image_cache_order.pop(0)
                        _image_cache.pop(oldest, None)
                
                _image_cache[item_id] = image_data
                _image_cache_order.append(item_id)
                
                return image_data
            else:
                # Mark as no-image to avoid future lookups
                _no_image_cache.add(item_id)
                return None
