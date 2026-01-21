# Faire API Integration for DM Brands
# API Docs: https://faire.github.io/external-api-v2-docs/
# Pilot brand: My Flame

import httpx
import json
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from database import (
    SessionLocal, FaireOrder, FaireProductMapping, 
    FaireBrandConfig, FaireWebhookLog
)

# Faire API base URL
FAIRE_API_BASE = "https://www.faire.com/external-api/v2"

# ============ API Client ============

class FaireClient:
    """Async client for Faire API v2"""
    
    def __init__(self, access_token: str, brand_name: str = "Unknown"):
        self.access_token = access_token
        self.brand_name = brand_name
        self.headers = {
            "X-FAIRE-ACCESS-TOKEN": access_token,
            "Content-Type": "application/json"
        }
    
    async def _request(
        self, 
        method: str, 
        endpoint: str, 
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Dict:
        """Make authenticated request to Faire API"""
        url = f"{FAIRE_API_BASE}{endpoint}"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=self.headers,
                json=data,
                params=params
            )
            
            if response.status_code == 401:
                raise FaireAuthError("Invalid or expired access token")
            elif response.status_code == 429:
                raise FaireRateLimitError("Rate limit exceeded")
            elif response.status_code >= 400:
                raise FaireAPIError(f"API error {response.status_code}: {response.text}")
            
            return response.json() if response.text else {}
    
    # ============ Products ============
    
    async def list_products(self, page: int = 1, limit: int = 50) -> Dict:
        """List all products for this brand"""
        return await self._request("GET", "/products", params={
            "page": page,
            "limit": limit
        })
    
    async def get_product(self, product_id: str) -> Dict:
        """Get a single product by ID"""
        return await self._request("GET", f"/products/{product_id}")
    
    async def create_product(self, product_data: Dict) -> Dict:
        """Create a new product on Faire
        
        Required fields:
        - name: str
        - wholesale_price_cents: int
        - retail_price_cents: int
        - active: bool
        - lifecycle_state: DRAFT | PUBLISHED | UNPUBLISHED
        - sale_state: FOR_SALE | SALES_PAUSED
        
        Optional:
        - description: str
        - short_description: str
        - product_options: list (variants)
        - taxonomy_type: dict (category)
        """
        return await self._request("POST", "/products", data=product_data)
    
    async def update_product(self, product_id: str, product_data: Dict) -> Dict:
        """Update an existing product"""
        return await self._request("PATCH", f"/products/{product_id}", data=product_data)
    
    async def delete_product(self, product_id: str) -> Dict:
        """Delete a product (sets lifecycle_state to DELETED)"""
        return await self._request("DELETE", f"/products/{product_id}")
    
    # ============ Inventory ============
    
    async def update_inventory_levels(self, inventory_updates: List[Dict]) -> Dict:
        """Bulk update inventory levels
        
        Each item should have:
        - sku: str (matches product_option.sku)
        - current_quantity: int
        - discontinued: bool (optional)
        - preorderable: bool (optional)
        - available_on: datetime (optional, for preorders)
        """
        return await self._request("PATCH", "/products/inventory-levels", data={
            "inventory_levels": inventory_updates
        })
    
    async def get_inventory_levels(self, skus: List[str]) -> Dict:
        """Get current inventory levels for specific SKUs"""
        return await self._request("POST", "/products/inventory-levels/query", data={
            "skus": skus
        })
    
    # ============ Orders ============
    
    async def list_orders(
        self, 
        page: int = 1, 
        limit: int = 50,
        state: Optional[str] = None,
        created_at_min: Optional[datetime] = None,
        created_at_max: Optional[datetime] = None
    ) -> Dict:
        """List orders with optional filters
        
        States: NEW, PROCESSING, PRE_TRANSIT, IN_TRANSIT, DELIVERED, CANCELED
        """
        params = {"page": page, "limit": limit}
        if state:
            params["state"] = state
        if created_at_min:
            params["created_at_min"] = created_at_min.isoformat()
        if created_at_max:
            params["created_at_max"] = created_at_max.isoformat()
        
        return await self._request("GET", "/orders", params=params)
    
    async def get_order(self, order_id: str) -> Dict:
        """Get a single order by ID"""
        return await self._request("GET", f"/orders/{order_id}")
    
    async def accept_order(self, order_id: str) -> Dict:
        """Accept an order (moves from NEW to PROCESSING)"""
        return await self._request("POST", f"/orders/{order_id}/processing")
    
    # ============ Shipments ============
    
    async def create_shipment(
        self, 
        order_id: str,
        tracking_number: str,
        carrier: str,
        items: Optional[List[Dict]] = None
    ) -> Dict:
        """Create shipment for an order
        
        Carrier options: UPS, FEDEX, USPS, DHL, ROYAL_MAIL, HERMES, DPD, etc.
        
        If items not specified, assumes all items shipped.
        """
        shipment_data = {
            "tracking_number": tracking_number,
            "carrier": carrier
        }
        if items:
            shipment_data["items"] = items  # [{product_option_id, quantity}]
        
        return await self._request("POST", f"/orders/{order_id}/shipments", data=shipment_data)
    
    async def get_shipments(self, order_id: str) -> Dict:
        """Get all shipments for an order"""
        return await self._request("GET", f"/orders/{order_id}/shipments")


# ============ Exceptions ============

class FaireAPIError(Exception):
    """Generic Faire API error"""
    pass

class FaireAuthError(FaireAPIError):
    """Authentication error"""
    pass

class FaireRateLimitError(FaireAPIError):
    """Rate limit exceeded"""
    pass


# ============ Helper Functions ============

def get_faire_client(brand_name: str) -> Optional[FaireClient]:
    """Get Faire client for a brand from database config"""
    db = SessionLocal()
    try:
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == brand_name,
            FaireBrandConfig.is_active == True
        ).first()
        
        if config and config.faire_access_token:
            return FaireClient(config.faire_access_token, brand_name)
        return None
    finally:
        db.close()


def log_webhook(webhook_type: str, payload: Dict, faire_order_id: Optional[str] = None) -> str:
    """Log incoming webhook for debugging"""
    db = SessionLocal()
    try:
        log_id = str(uuid.uuid4())
        log = FaireWebhookLog(
            id=log_id,
            webhook_type=webhook_type,
            faire_order_id=faire_order_id,
            payload_json=json.dumps(payload)
        )
        db.add(log)
        db.commit()
        return log_id
    except Exception as e:
        print(f"FAIRE: Error logging webhook: {e}")
        db.rollback()
        return ""
    finally:
        db.close()


# ============ Order Processing ============

async def process_faire_order(order_data: Dict, brand_name: str) -> Optional[FaireOrder]:
    """Process a Faire order and store in database
    
    Returns the created FaireOrder or None if failed
    """
    db = SessionLocal()
    try:
        faire_order_id = order_data.get("id")
        
        # Check if already processed
        existing = db.query(FaireOrder).filter(
            FaireOrder.faire_order_id == faire_order_id
        ).first()
        
        if existing:
            print(f"FAIRE: Order {faire_order_id} already exists")
            return existing
        
        # Extract address info
        address = order_data.get("address", {})
        
        # Get retailer info
        retailer = order_data.get("retailer", {})
        
        # Calculate totals
        items = order_data.get("items", [])
        total_cents = sum(
            item.get("price_cents", 0) * item.get("quantity", 0) 
            for item in items
        )
        
        # Create order record
        order = FaireOrder(
            id=str(uuid.uuid4()),
            faire_order_id=faire_order_id,
            faire_brand_token="",  # Will be set from config
            brand_name=brand_name,
            retailer_id=retailer.get("id"),
            retailer_name=retailer.get("name", "Unknown Retailer"),
            retailer_email=retailer.get("email"),
            ship_city=address.get("city"),
            ship_region=address.get("state"),  # Faire uses "state" for region
            ship_postcode=address.get("postal_code"),
            ship_country=address.get("country_code", "GB"),
            order_total_cents=total_cents,
            currency=order_data.get("currency", "GBP"),
            item_count=len(items),
            order_items_json=json.dumps(items),
            faire_state=order_data.get("state", "NEW"),
            faire_created_at=datetime.fromisoformat(
                order_data.get("created_at").replace("Z", "+00:00")
            ) if order_data.get("created_at") else None
        )
        
        db.add(order)
        db.commit()
        db.refresh(order)
        
        print(f"FAIRE: Created order record for {faire_order_id} - {retailer.get('name')}")
        return order
        
    except Exception as e:
        print(f"FAIRE: Error processing order: {e}")
        db.rollback()
        return None
    finally:
        db.close()


# ============ Inventory Sync ============

async def sync_inventory_to_faire(brand_name: str, stock_data: Dict[str, int]) -> Dict:
    """Sync inventory levels to Faire for a brand
    
    stock_data: Dict mapping SKU -> quantity
    
    For Räder: Apply ≤9=0 rule BEFORE calling this function
    
    Returns: {synced: int, errors: list}
    """
    client = get_faire_client(brand_name)
    if not client:
        return {"synced": 0, "errors": [f"No active Faire config for {brand_name}"]}
    
    # Build inventory updates
    inventory_updates = []
    for sku, qty in stock_data.items():
        inventory_updates.append({
            "sku": sku,
            "current_quantity": max(0, qty),  # Never negative
            "discontinued": False
        })
    
    # Faire accepts batches - process in chunks of 100
    results = {"synced": 0, "errors": []}
    
    for i in range(0, len(inventory_updates), 100):
        batch = inventory_updates[i:i+100]
        try:
            await client.update_inventory_levels(batch)
            results["synced"] += len(batch)
        except Exception as e:
            results["errors"].append(f"Batch {i//100}: {str(e)}")
    
    # Update last sync time
    db = SessionLocal()
    try:
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == brand_name
        ).first()
        if config:
            config.last_inventory_sync = datetime.utcnow()
            db.commit()
    finally:
        db.close()
    
    return results


# ============ Product Mapping ============

def get_sku_mapping(brand_name: str) -> Dict[str, str]:
    """Get Zoho SKU -> Faire product_option_id mapping for a brand"""
    db = SessionLocal()
    try:
        mappings = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.is_synced == True
        ).all()
        
        return {m.zoho_sku: m.faire_product_option_id for m in mappings if m.faire_product_option_id}
    finally:
        db.close()


def get_faire_sku_to_zoho_sku(brand_name: str) -> Dict[str, str]:
    """Get Faire SKU -> Zoho SKU mapping (reverse lookup for orders)"""
    db = SessionLocal()
    try:
        mappings = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.is_synced == True
        ).all()
        
        # Assuming Faire SKU matches Zoho SKU (simplest approach)
        return {m.zoho_sku: m.zoho_sku for m in mappings}
    finally:
        db.close()


# ============ My Flame Specific ============

def prepare_myflame_product_for_faire(zoho_item: Dict) -> Optional[Dict]:
    """Convert a Zoho My Flame item to Faire product format
    
    Returns None if item shouldn't be synced
    """
    # Filter criteria
    if not zoho_item.get("is_active", False):
        return None
    
    brand = zoho_item.get("brand", "")
    if "My Flame" not in brand and "Myflame" not in brand.lower():
        return None
    
    sku = zoho_item.get("sku", "")
    name = zoho_item.get("name", "")
    
    # Get pricing - Faire needs wholesale in cents
    # Assuming Zoho stores wholesale price
    wholesale_price = zoho_item.get("rate", 0)  # Check your actual field
    wholesale_cents = int(wholesale_price * 100)
    
    # Estimate retail at 2x wholesale (adjust as needed)
    retail_cents = wholesale_cents * 2
    
    # Build Faire product
    faire_product = {
        "name": name,
        "wholesale_price_cents": wholesale_cents,
        "retail_price_cents": retail_cents,
        "active": True,
        "lifecycle_state": "PUBLISHED",
        "sale_state": "FOR_SALE",
        "description": zoho_item.get("description", ""),
        "product_options": [{
            "sku": sku,
            "active": True
        }]
    }
    
    # Add images if available
    images = []
    if zoho_item.get("image_url"):
        images.append({"url": zoho_item["image_url"]})
    if zoho_item.get("cf_cdn_image_url"):
        images.append({"url": zoho_item["cf_cdn_image_url"]})
    
    if images:
        faire_product["images"] = images
    
    return faire_product
