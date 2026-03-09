# Faire API Integration for DM Brands
# API Docs: https://faire.github.io/external-api-v2-docs/
# v2 API - uses amount_minor (pence/cents) + currency objects for pricing

import httpx
import json
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from database import (
    SessionLocal, FaireOrder, FaireProductMapping,
    FaireBrandConfig, FaireWebhookLog
)

FAIRE_API_BASE = "https://www.faire.com/external-api/v2"


# ============ API Client ============

class FaireClient:
    """Async client for Faire External API v2"""

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
        params: Optional[Dict] = None,
        timeout: float = 30.0
    ) -> Dict:
        url = f"{FAIRE_API_BASE}{endpoint}"
        async with httpx.AsyncClient(timeout=timeout) as client:
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

    # ============ Brand / Account ============

    async def get_brand(self) -> Dict:
        """Get the brand account details (verifies token, returns brand ID)"""
        return await self._request("GET", "/brand")

    # ============ Products ============

    async def list_products(self, page_token: Optional[str] = None, limit: int = 50) -> Dict:
        """List all products. Uses cursor pagination (page_token)."""
        params = {"limit": limit}
        if page_token:
            params["page_token"] = page_token
        return await self._request("GET", "/products", params=params)

    async def get_product(self, product_id: str) -> Dict:
        return await self._request("GET", f"/products/{product_id}")

    async def create_product(self, product_data: Dict) -> Dict:
        """Create a new product on Faire.

        Minimum required for DRAFT:
        - name: str
        - variants: list of variant objects

        Required for PUBLISHED:
        - All DRAFT fields
        - At least one image on the product or variant
        - wholesale_price set on variants

        Pricing uses v2 format:
        {
          "prices": [{
            "geo_constraint": {"country": "GBR"},
            "wholesale_price": {"amount_minor": 1200, "currency": "GBP"},
            "retail_price": {"amount_minor": 2400, "currency": "GBP"}
          }]
        }
        """
        return await self._request("POST", "/products", data=product_data)

    async def update_product(self, product_id: str, product_data: Dict) -> Dict:
        return await self._request("PATCH", f"/products/{product_id}", data=product_data)

    async def delete_product(self, product_id: str) -> Dict:
        return await self._request("DELETE", f"/products/{product_id}")

    # ============ Product Variants ============

    async def update_variant(self, product_id: str, variant_id: str, variant_data: Dict) -> Dict:
        """Update a single variant (pricing, inventory, images, lifecycle_state)"""
        return await self._request("PATCH", f"/products/{product_id}/variants/{variant_id}", data=variant_data)

    async def bulk_update_variant_prices(self, updates: List[Dict]) -> Dict:
        """Bulk update prices for multiple variants.
        updates: [{"product_variant_id": str, "prices": [...]}]
        """
        return await self._request("PATCH", "/products/variants/prices", data={"updates": updates})

    # ============ Images ============

    async def upload_image_from_url(self, image_url: str) -> Dict:
        """Upload an image to Faire from a URL.
        Returns: {"image_token": "...", "url": "..."}
        The image_token can then be used in product/variant image arrays.
        """
        return await self._request("POST", "/images", data={"url": image_url})

    async def upload_image_bytes(self, image_bytes: bytes, content_type: str = "image/jpeg") -> Dict:
        """Upload raw image bytes to Faire.
        Returns: {"image_token": "...", "url": "..."}
        """
        url = f"{FAIRE_API_BASE}/images"
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                headers={
                    "X-FAIRE-ACCESS-TOKEN": self.access_token,
                    "Content-Type": content_type
                },
                content=image_bytes
            )
            if response.status_code >= 400:
                raise FaireAPIError(f"Image upload error {response.status_code}: {response.text}")
            return response.json()

    # ============ Inventory ============

    async def update_inventory_levels(self, inventory_updates: List[Dict]) -> Dict:
        """Bulk update inventory levels by SKU.
        Each item: {"sku": str, "available_quantity": int, "discontinued": bool (opt)}
        Note: v2 uses 'available_quantity', not 'current_quantity'
        """
        return await self._request("PATCH", "/products/inventory-levels", data={
            "inventory_levels": inventory_updates
        })

    async def get_inventory_levels(self, skus: List[str]) -> Dict:
        return await self._request("POST", "/products/inventory-levels/query", data={"skus": skus})

    # ============ Orders ============

    async def list_orders(
        self,
        page_token: Optional[str] = None,
        limit: int = 50,
        state: Optional[str] = None,
        updated_at_min: Optional[datetime] = None
    ) -> Dict:
        """List orders. States: NEW, PROCESSING, PRE_TRANSIT, IN_TRANSIT, DELIVERED, CANCELED"""
        params = {"limit": limit}
        if page_token:
            params["page_token"] = page_token
        if state:
            params["state"] = state
        if updated_at_min:
            params["updated_at_min"] = updated_at_min.isoformat() + "Z"
        return await self._request("GET", "/orders", params=params)

    async def get_order(self, order_id: str) -> Dict:
        return await self._request("GET", f"/orders/{order_id}")

    async def accept_order(self, order_id: str) -> Dict:
        """Accept order → moves NEW to PROCESSING"""
        return await self._request("POST", f"/orders/{order_id}/processing")

    # ============ Shipments ============

    async def create_shipment(
        self,
        order_id: str,
        tracking_number: str,
        carrier: str,
        items: Optional[List[Dict]] = None
    ) -> Dict:
        """Create shipment. Carrier: ROYAL_MAIL, DPD, DHL, HERMES, UPS, FEDEX, etc."""
        shipment_data = {"tracking_number": tracking_number, "carrier": carrier}
        if items:
            shipment_data["items"] = items
        return await self._request("POST", f"/orders/{order_id}/shipments", data=shipment_data)


# ============ Exceptions ============

class FaireAPIError(Exception):
    pass

class FaireAuthError(FaireAPIError):
    pass

class FaireRateLimitError(FaireAPIError):
    pass


# ============ Client Factory ============

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


# ============ Webhook Logging ============

def log_webhook(webhook_type: str, payload: Dict, faire_order_id: Optional[str] = None) -> str:
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


# ============ Pricing Helpers (v2) ============

def make_price(amount_gbp: float, currency: str = "GBP") -> Dict:
    """Convert a GBP float to Faire v2 price object (pence)"""
    return {
        "amount_minor": int(round(amount_gbp * 100)),
        "currency": currency
    }

def make_geo_price(wholesale_gbp: float, retail_gbp: float, country: str = "GBR") -> Dict:
    """Build a Faire v2 geo-constrained price entry"""
    return {
        "geo_constraint": {"country": country},
        "wholesale_price": make_price(wholesale_gbp),
        "retail_price": make_price(retail_gbp)
    }

def extract_order_price(price_obj: Any) -> float:
    """Extract GBP float from a Faire v2 price object or legacy int"""
    if isinstance(price_obj, dict):
        return price_obj.get("amount_minor", 0) / 100
    if isinstance(price_obj, (int, float)):
        return price_obj / 100
    return 0.0


# ============ Order Processing ============

async def process_faire_order(order_data: Dict, brand_name: str) -> Optional[FaireOrder]:
    """Process a Faire order and store in database"""
    db = SessionLocal()
    try:
        faire_order_id = order_data.get("id")

        existing = db.query(FaireOrder).filter(
            FaireOrder.faire_order_id == faire_order_id
        ).first()
        if existing:
            # Update state if changed
            new_state = order_data.get("state", existing.faire_state)
            if new_state != existing.faire_state:
                existing.faire_state = new_state
                db.commit()
            return existing

        address = order_data.get("address", {})
        retailer = order_data.get("retailer", {})
        items = order_data.get("items", [])

        # Calculate total from v2 price objects
        total_pence = 0
        for item in items:
            price_obj = item.get("price") or item.get("price_cents", 0)
            qty = item.get("quantity", 0)
            total_pence += int(extract_order_price(price_obj) * 100) * qty

        order = FaireOrder(
            id=str(uuid.uuid4()),
            faire_order_id=faire_order_id,
            faire_brand_token="",
            brand_name=brand_name,
            retailer_id=retailer.get("id"),
            retailer_name=retailer.get("name", "Unknown Retailer"),
            retailer_email=retailer.get("email"),
            ship_city=address.get("city"),
            ship_region=address.get("state"),
            ship_postcode=address.get("postal_code"),
            ship_country=address.get("country_code", "GB"),
            order_total_cents=total_pence,
            currency=order_data.get("currency", "GBP"),
            item_count=len(items),
            order_items_json=json.dumps(items),
            faire_state=order_data.get("state", "NEW"),
            faire_created_at=datetime.fromisoformat(
                order_data["created_at"].replace("Z", "+00:00")
            ) if order_data.get("created_at") else None
        )

        db.add(order)
        db.commit()
        db.refresh(order)
        print(f"FAIRE: Created order {faire_order_id} – {retailer.get('name')}")
        return order

    except Exception as e:
        print(f"FAIRE: Error processing order: {e}")
        db.rollback()
        return None
    finally:
        db.close()


# ============ Inventory Sync ============

async def sync_inventory_to_faire(brand_name: str, stock_data: Dict[str, int]) -> Dict:
    """Sync inventory levels to Faire.
    stock_data: {sku: quantity}
    Apply any brand-specific rules (e.g. Räder ≤9→0) BEFORE calling this.
    """
    client = get_faire_client(brand_name)
    if not client:
        return {"synced": 0, "errors": [f"No active Faire config for {brand_name}"]}

    inventory_updates = [
        {"sku": sku, "available_quantity": max(0, qty), "discontinued": False}
        for sku, qty in stock_data.items()
    ]

    results = {"synced": 0, "errors": []}
    for i in range(0, len(inventory_updates), 100):
        batch = inventory_updates[i:i + 100]
        try:
            await client.update_inventory_levels(batch)
            results["synced"] += len(batch)
        except Exception as e:
            results["errors"].append(f"Batch {i // 100}: {str(e)}")

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


# ============ Product Mapping Helpers ============

def get_sku_mapping(brand_name: str) -> Dict[str, str]:
    """Zoho SKU → Faire product_option_id"""
    db = SessionLocal()
    try:
        mappings = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.is_synced == True
        ).all()
        return {m.zoho_sku: m.faire_product_option_id for m in mappings if m.faire_product_option_id}
    finally:
        db.close()

def get_faire_product_id_by_sku(brand_name: str, zoho_sku: str) -> Optional[str]:
    """Get Faire product_id for a Zoho SKU"""
    db = SessionLocal()
    try:
        mapping = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.zoho_sku == zoho_sku
        ).first()
        return mapping.faire_product_id if mapping else None
    finally:
        db.close()

def save_product_mapping(
    brand_name: str,
    zoho_sku: str,
    zoho_item_id: str,
    faire_product_id: str,
    faire_variant_id: str,
    error: Optional[str] = None
):
    """Upsert a SKU→Faire product mapping"""
    db = SessionLocal()
    try:
        mapping = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.zoho_sku == zoho_sku
        ).first()

        if mapping:
            mapping.faire_product_id = faire_product_id
            mapping.faire_product_option_id = faire_variant_id
            mapping.is_synced = (error is None and bool(faire_product_id))
            mapping.last_synced_at = datetime.utcnow() if not error else mapping.last_synced_at
            mapping.sync_error = error
        else:
            mapping = FaireProductMapping(
                id=str(uuid.uuid4()),
                brand_name=brand_name,
                zoho_sku=zoho_sku,
                zoho_item_id=zoho_item_id,
                faire_product_id=faire_product_id,
                faire_product_option_id=faire_variant_id,
                is_synced=(error is None and bool(faire_product_id)),
                last_synced_at=datetime.utcnow() if not error else None,
                sync_error=error
            )
            db.add(mapping)

        db.commit()
    except Exception as e:
        print(f"FAIRE: Error saving mapping for {zoho_sku}: {e}")
        db.rollback()
    finally:
        db.close()
