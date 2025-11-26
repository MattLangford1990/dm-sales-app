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

# Image cache - stores {item_id: {"data": bytes, "cached_at": datetime}}
_image_cache = {}
IMAGE_CACHE_TTL = timedelta(hours=24)  # Cache images for 24 hours

# Rate limiting for image requests
_image_request_semaphore = asyncio.Semaphore(2)  # Max 2 concurrent image requests

# Global rate limit cooldown
_rate_limit_cooldown = {
    "blocked_until": None
}
RATE_LIMIT_COOLDOWN = timedelta(minutes=2)  # Wait 2 minutes after being rate limited


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
        response.raise_for_status()
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
    
    return await zoho_request("GET", "items", params=params)


async def get_item(item_id: str) -> dict:
    """Get a single item by ID"""
    return await zoho_request("GET", f"items/{item_id}")


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
    """Get item image as bytes with caching and rate limiting"""
    now = datetime.now()
    
    # Check cache first
    if item_id in _image_cache:
        cached = _image_cache[item_id]
        if now - cached["cached_at"] < IMAGE_CACHE_TTL:
            return cached["data"]
        else:
            # Cache expired, remove it
            del _image_cache[item_id]
    
    # Check if we're in a global rate limit cooldown
    if _rate_limit_cooldown["blocked_until"]:
        if now < _rate_limit_cooldown["blocked_until"]:
            remaining = (_rate_limit_cooldown["blocked_until"] - now).seconds
            print(f"Rate limit cooldown active, {remaining}s remaining - skipping image {item_id}")
            return None
        else:
            # Cooldown expired
            _rate_limit_cooldown["blocked_until"] = None
    
    # Use semaphore to limit concurrent requests to Zoho
    async with _image_request_semaphore:
        # Double-check cache (another request might have fetched it while waiting)
        if item_id in _image_cache:
            cached = _image_cache[item_id]
            if now - cached["cached_at"] < IMAGE_CACHE_TTL:
                return cached["data"]
        
        # Check cooldown again after waiting for semaphore
        if _rate_limit_cooldown["blocked_until"] and datetime.now() < _rate_limit_cooldown["blocked_until"]:
            return None
        
        # Add small delay to avoid hammering the API
        await asyncio.sleep(0.2)
        
        token = await get_access_token()
        
        headers = {
            "Authorization": f"Zoho-oauthtoken {token}"
        }
        
        base_url = "https://www.zohoapis.eu/inventory/v1"
        url = f"{base_url}/items/{item_id}/image"
        
        params = {"organization_id": settings.zoho_org_id}
        
        # Retry logic for rate limits
        max_retries = 3
        for attempt in range(max_retries):
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers, params=params)
                
                if response.status_code == 200:
                    # Cache the image
                    _image_cache[item_id] = {
                        "data": response.content,
                        "cached_at": datetime.now()
                    }
                    return response.content
                elif response.status_code == 429:
                    # Rate limited - set global cooldown and stop trying
                    _rate_limit_cooldown["blocked_until"] = datetime.now() + RATE_LIMIT_COOLDOWN
                    print(f"Rate limited! Setting {RATE_LIMIT_COOLDOWN.seconds}s global cooldown")
                    return None
                else:
                    # Other error - don't retry
                    print(f"Image request for {item_id}: status={response.status_code}")
                    return None
        
        return None
