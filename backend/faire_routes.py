# faire_routes.py
# FastAPI routes for Faire marketplace integration

from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import json

from database import (
    SessionLocal, FaireOrder, FaireProductMapping,
    FaireBrandConfig, FaireWebhookLog
)
import faire_api
import faire_product_sync
from faire_api import (
    FaireClient, get_faire_client, process_faire_order,
    sync_inventory_to_faire, log_webhook
)
from faire_territory import get_agent_for_postcode, get_territory_summary
import zoho_api

router = APIRouter(prefix="/api/faire", tags=["faire"])


# ============ Pydantic Models ============

class FaireBrandConfigCreate(BaseModel):
    brand_name: str
    faire_access_token: str
    is_active: bool = True
    sync_inventory: bool = True
    inventory_buffer: int = 0


class FaireBrandConfigUpdate(BaseModel):
    faire_access_token: Optional[str] = None
    is_active: Optional[bool] = None
    sync_inventory: Optional[bool] = None
    inventory_buffer: Optional[int] = None


class InventorySyncRequest(BaseModel):
    brand_name: str
    sku_quantities: Optional[Dict[str, int]] = None


class BulkPushRequest(BaseModel):
    brand_name: str
    limit: Optional[int] = None
    publish: bool = False
    skip_existing: bool = True


class SingleProductPushRequest(BaseModel):
    brand_name: str
    zoho_sku: str
    publish: bool = False
    generate_description: bool = True


class UpdateProductRequest(BaseModel):
    brand_name: str
    zoho_sku: str
    fields: Optional[List[str]] = None  # ['description','price','inventory','image'] or None=all


class ShipmentRequest(BaseModel):
    tracking_number: str
    carrier: str  # ROYAL_MAIL, DPD, DHL, HERMES, UPS, FEDEX
    push_to_faire: bool = True


# ============ Brand Config ============

@router.get("/brands")
async def list_faire_brands():
    """List all configured Faire brand storefronts"""
    db = SessionLocal()
    try:
        configs = db.query(FaireBrandConfig).all()
        return {
            "brands": [
                {
                    "brand_name": c.brand_name,
                    "is_active": c.is_active,
                    "sync_inventory": c.sync_inventory,
                    "inventory_buffer": c.inventory_buffer,
                    "last_inventory_sync": c.last_inventory_sync.isoformat() if c.last_inventory_sync else None,
                    "last_order_check": c.last_order_check.isoformat() if c.last_order_check else None,
                    "has_token": bool(c.faire_access_token)
                }
                for c in configs
            ]
        }
    finally:
        db.close()


@router.post("/brands")
async def create_faire_brand(config: FaireBrandConfigCreate):
    """Add a new Faire brand storefront"""
    db = SessionLocal()
    try:
        existing = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == config.brand_name
        ).first()
        if existing:
            raise HTTPException(400, f"Brand {config.brand_name} already configured")

        new_config = FaireBrandConfig(
            id=config.brand_name.lower().replace(" ", "_"),
            brand_name=config.brand_name,
            faire_access_token=config.faire_access_token,
            is_active=config.is_active,
            sync_inventory=config.sync_inventory,
            inventory_buffer=config.inventory_buffer
        )
        db.add(new_config)
        db.commit()
        return {"success": True, "message": f"Brand {config.brand_name} configured"}
    finally:
        db.close()


@router.put("/brands/{brand_name}")
async def update_faire_brand(brand_name: str, updates: FaireBrandConfigUpdate):
    """Update brand configuration (e.g. rotate token, pause sync)"""
    db = SessionLocal()
    try:
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == brand_name
        ).first()
        if not config:
            raise HTTPException(404, f"Brand {brand_name} not found")

        if updates.faire_access_token is not None:
            config.faire_access_token = updates.faire_access_token
        if updates.is_active is not None:
            config.is_active = updates.is_active
        if updates.sync_inventory is not None:
            config.sync_inventory = updates.sync_inventory
        if updates.inventory_buffer is not None:
            config.inventory_buffer = updates.inventory_buffer

        db.commit()
        return {"success": True, "message": f"Brand {brand_name} updated"}
    finally:
        db.close()


@router.post("/brands/{brand_name}/test")
async def test_faire_connection(brand_name: str):
    """Test Faire API connection — verifies token and returns brand info"""
    client = get_faire_client(brand_name)
    if not client:
        raise HTTPException(404, f"No active config for {brand_name}")
    try:
        result = await client.get_brand()
        brand_info = result.get("brand", result)
        return {
            "success": True,
            "brand_id": brand_info.get("id"),
            "brand_name_on_faire": brand_info.get("name"),
            "currency": brand_info.get("currency"),
            "message": "Connection successful"
        }
    except faire_api.FaireAuthError:
        raise HTTPException(401, "Invalid access token")
    except Exception as e:
        raise HTTPException(500, f"Connection failed: {str(e)}")


# ============ Product Sync ============

@router.get("/products/status/{brand_name}")
async def get_product_sync_status(brand_name: str):
    """Summary of how many products are synced vs outstanding"""
    status = await faire_product_sync.get_sync_status(brand_name)
    return status


@router.post("/products/push-single")
async def push_single_product(req: SingleProductPushRequest, background_tasks: BackgroundTasks):
    """Push a single Zoho SKU to Faire"""
    client = get_faire_client(req.brand_name)
    if not client:
        raise HTTPException(404, f"No active config for {req.brand_name}")

    all_items = await zoho_api.get_all_items_cached()
    item = next((i for i in all_items if i.get("sku") == req.zoho_sku), None)
    if not item:
        raise HTTPException(404, f"SKU {req.zoho_sku} not found in Zoho")

    result = await faire_product_sync.push_product_to_faire(
        client=client,
        item=item,
        brand_name=req.brand_name,
        publish=req.publish,
        generate_description=req.generate_description
    )
    return result


@router.post("/products/push-bulk")
async def push_bulk_products(req: BulkPushRequest, background_tasks: BackgroundTasks):
    """Push all active brand products to Faire in the background.
    Returns immediately; check /products/status/{brand_name} for progress.
    For small batches (limit ≤ 20) runs synchronously and returns results.
    """
    if req.limit and req.limit <= 20:
        # Synchronous for small batches
        result = await faire_product_sync.bulk_push_products_to_faire(
            brand_name=req.brand_name,
            limit=req.limit,
            publish=req.publish,
            skip_existing=req.skip_existing
        )
        return result
    else:
        # Run in background for large batches
        background_tasks.add_task(
            faire_product_sync.bulk_push_products_to_faire,
            brand_name=req.brand_name,
            limit=req.limit,
            publish=req.publish,
            skip_existing=req.skip_existing
        )
        return {
            "message": f"Bulk push started in background for {req.brand_name}",
            "check_status": f"/api/faire/products/status/{req.brand_name}"
        }


@router.post("/products/update")
async def update_product(req: UpdateProductRequest):
    """Update an existing Faire product (description/price/inventory/image)"""
    result = await faire_product_sync.update_product_on_faire(
        brand_name=req.brand_name,
        zoho_sku=req.zoho_sku,
        fields_to_update=req.fields
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/products/publish-drafts/{brand_name}")
async def publish_draft_products(brand_name: str, limit: int = 50):
    """Attempt to publish all DRAFT products that are ready"""
    result = await faire_product_sync.publish_drafted_products(brand_name, limit=limit)
    return result


@router.get("/products/mappings/{brand_name}")
async def list_product_mappings(brand_name: str, synced_only: bool = False, page: int = 1, per_page: int = 100):
    """List SKU→Faire product mappings"""
    db = SessionLocal()
    try:
        query = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name
        )
        if synced_only:
            query = query.filter(FaireProductMapping.is_synced == True)

        total = query.count()
        mappings = query.offset((page - 1) * per_page).limit(per_page).all()

        return {
            "brand_name": brand_name,
            "total": total,
            "page": page,
            "mappings": [
                {
                    "zoho_sku": m.zoho_sku,
                    "faire_product_id": m.faire_product_id,
                    "faire_variant_id": m.faire_product_option_id,
                    "is_synced": m.is_synced,
                    "last_synced_at": m.last_synced_at.isoformat() if m.last_synced_at else None,
                    "sync_error": m.sync_error
                }
                for m in mappings
            ]
        }
    finally:
        db.close()


@router.delete("/products/mappings/{brand_name}/{zoho_sku}")
async def delete_product_mapping(brand_name: str, zoho_sku: str):
    """Remove a SKU mapping (allows re-sync of that product)"""
    db = SessionLocal()
    try:
        mapping = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.zoho_sku == zoho_sku
        ).first()
        if not mapping:
            raise HTTPException(404, "Mapping not found")
        db.delete(mapping)
        db.commit()
        return {"success": True, "message": f"Mapping for {zoho_sku} deleted"}
    finally:
        db.close()


# ============ Orders ============

@router.get("/orders")
async def list_faire_orders(
    brand_name: Optional[str] = None,
    status: Optional[str] = None,
    synced_to_zoho: Optional[bool] = None,
    limit: int = 50
):
    """List Faire orders stored in our database"""
    db = SessionLocal()
    try:
        query = db.query(FaireOrder)
        if brand_name:
            query = query.filter(FaireOrder.brand_name == brand_name)
        if status:
            query = query.filter(FaireOrder.faire_state == status)
        if synced_to_zoho is not None:
            if synced_to_zoho:
                query = query.filter(FaireOrder.synced_to_zoho_at.isnot(None))
            else:
                query = query.filter(FaireOrder.synced_to_zoho_at.is_(None))

        orders = query.order_by(FaireOrder.created_at.desc()).limit(limit).all()
        return {
            "orders": [
                {
                    "id": o.id,
                    "faire_order_id": o.faire_order_id,
                    "brand_name": o.brand_name,
                    "retailer_name": o.retailer_name,
                    "total": round(o.order_total_cents / 100, 2) if o.order_total_cents else 0,
                    "currency": o.currency,
                    "item_count": o.item_count,
                    "faire_state": o.faire_state,
                    "ship_postcode": o.ship_postcode,
                    "ship_country": o.ship_country,
                    "zoho_sales_order_number": o.zoho_sales_order_number,
                    "synced_to_zoho": o.synced_to_zoho_at is not None,
                    "assigned_agent": o.assigned_agent_id,
                    "tracking_number": o.tracking_number,
                    "faire_created_at": o.faire_created_at.isoformat() if o.faire_created_at else None,
                    "created_at": o.created_at.isoformat() if o.created_at else None
                }
                for o in orders
            ]
        }
    finally:
        db.close()


@router.get("/orders/{order_id}")
async def get_faire_order(order_id: str):
    """Get a single Faire order by internal ID"""
    db = SessionLocal()
    try:
        order = db.query(FaireOrder).filter(FaireOrder.id == order_id).first()
        if not order:
            raise HTTPException(404, "Order not found")
        return {
            "id": order.id,
            "faire_order_id": order.faire_order_id,
            "brand_name": order.brand_name,
            "retailer_name": order.retailer_name,
            "retailer_email": order.retailer_email,
            "ship_address": {
                "city": order.ship_city,
                "region": order.ship_region,
                "postcode": order.ship_postcode,
                "country": order.ship_country
            },
            "total": round(order.order_total_cents / 100, 2) if order.order_total_cents else 0,
            "currency": order.currency,
            "item_count": order.item_count,
            "items": json.loads(order.order_items_json) if order.order_items_json else [],
            "faire_state": order.faire_state,
            "zoho_customer_id": order.zoho_customer_id,
            "zoho_sales_order_id": order.zoho_sales_order_id,
            "zoho_sales_order_number": order.zoho_sales_order_number,
            "synced_to_zoho_at": order.synced_to_zoho_at.isoformat() if order.synced_to_zoho_at else None,
            "assigned_agent_id": order.assigned_agent_id,
            "tracking_number": order.tracking_number,
            "carrier": order.carrier,
            "tracking_pushed_to_faire": order.tracking_pushed_to_faire,
            "faire_created_at": order.faire_created_at.isoformat() if order.faire_created_at else None
        }
    finally:
        db.close()


@router.post("/orders/poll/{brand_name}")
async def poll_faire_orders(brand_name: str, days_back: int = 7):
    """Poll Faire for new/updated orders for a brand"""
    client = get_faire_client(brand_name)
    if not client:
        raise HTTPException(404, f"No active config for {brand_name}")

    try:
        result = await client.list_orders(
            limit=50,
            updated_at_min=datetime.utcnow() - timedelta(days=days_back)
        )

        orders_data = result.get("orders", [])
        new_orders = []
        updated_orders = []

        for order_data in orders_data:
            order = await process_faire_order(order_data, brand_name)
            if order:
                if order.faire_created_at and (datetime.utcnow() - order.faire_created_at).days < 1:
                    new_orders.append(order.faire_order_id)
                else:
                    updated_orders.append(order.faire_order_id)

        # Update last check timestamp
        db = SessionLocal()
        try:
            config = db.query(FaireBrandConfig).filter(
                FaireBrandConfig.brand_name == brand_name
            ).first()
            if config:
                config.last_order_check = datetime.utcnow()
                db.commit()
        finally:
            db.close()

        return {
            "success": True,
            "orders_checked": len(orders_data),
            "new_orders": new_orders,
            "updated_orders": updated_orders
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to poll orders: {str(e)}")


@router.post("/orders/{order_id}/sync-to-zoho")
async def sync_order_to_zoho(order_id: str):
    """Create Zoho sales order from a Faire order, assign to agent by territory"""
    db = SessionLocal()
    try:
        order = db.query(FaireOrder).filter(FaireOrder.id == order_id).first()
        if not order:
            raise HTTPException(404, "Order not found")

        if order.synced_to_zoho_at:
            return {
                "success": False,
                "message": "Already synced to Zoho",
                "zoho_sales_order_id": order.zoho_sales_order_id,
                "zoho_sales_order_number": order.zoho_sales_order_number
            }

        # 1. Determine agent from postcode
        agent_id = get_agent_for_postcode(order.ship_postcode, order.ship_country)

        # 2. Find/create Zoho customer "Faire - [Retailer Name]"
        customer_name = f"Faire - {order.retailer_name}"
        contacts_response = await zoho_api.get_contacts(search=customer_name)
        contacts = contacts_response.get("contacts", [])
        zoho_customer_id = None

        for contact in contacts:
            if contact.get("company_name") == customer_name or contact.get("contact_name") == customer_name:
                zoho_customer_id = contact.get("contact_id")
                break

        if not zoho_customer_id:
            contact_data = {
                "contact_name": customer_name,
                "company_name": customer_name,
                "contact_type": "customer",
                "notes": (
                    f"Faire retailer: {order.retailer_name}\n"
                    f"Faire retailer ID: {order.retailer_id or 'N/A'}\n"
                    f"Email: {order.retailer_email or 'N/A'}\n"
                    f"Channel: Faire Marketplace"
                )
            }
            if order.retailer_email:
                contact_data["email"] = order.retailer_email
            if order.ship_postcode:
                contact_data["shipping_address"] = {
                    "city": order.ship_city or "",
                    "state": order.ship_region or "",
                    "zip": order.ship_postcode or "",
                    "country": "UK" if order.ship_country == "GB" else (order.ship_country or "UK")
                }

            create_resp = await zoho_api.create_contact(contact_data)
            zoho_customer_id = create_resp.get("contact", {}).get("contact_id")

        if not zoho_customer_id:
            raise HTTPException(500, "Failed to get or create Zoho customer")

        # 3. Map line items
        order_items = json.loads(order.order_items_json) if order.order_items_json else []
        if not order_items:
            raise HTTPException(400, "Order has no line items")

        all_items = await zoho_api.get_all_items_cached()
        sku_to_item = {item.get("sku"): item for item in all_items if item.get("sku")}

        line_items = []
        unmapped_skus = []

        for faire_item in order_items:
            # Extract SKU from v2 or v1 order item structure
            product_option = faire_item.get("product_option", {})
            sku = (
                product_option.get("sku")
                or faire_item.get("sku")
                or product_option.get("external_id")
                or ""
            )
            quantity = faire_item.get("quantity", 1)

            # Extract price (v2 uses price object, v1 used price_cents)
            price_obj = faire_item.get("price") or faire_item.get("price_cents", 0)
            price_gbp = faire_api.extract_order_price(price_obj)

            zoho_item = sku_to_item.get(sku)
            if zoho_item:
                line_items.append({
                    "item_id": zoho_item.get("item_id"),
                    "quantity": quantity,
                    "rate": price_gbp
                })
            else:
                unmapped_skus.append(sku)

        if not line_items:
            raise HTTPException(400, f"No items mapped to Zoho. Unmapped: {unmapped_skus}")

        # 4. Create Zoho sales order
        notes = (
            f"Faire Order: {order.faire_order_id}\n"
            f"Faire Retailer: {order.retailer_name}\n"
            f"Channel: Faire Marketplace\n"
            f"Brand: {order.brand_name}\n"
            f"Agent: {agent_id}"
        )
        if unmapped_skus:
            notes += f"\nUnmapped SKUs: {', '.join(unmapped_skus[:10])}"

        so_data = {
            "customer_id": zoho_customer_id,
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "line_items": line_items,
            "reference_number": f"FAIRE-{order.faire_order_id[:8].upper()}",
            "notes": notes,
            "salesperson_id": None  # TODO: map agent_id to Zoho salesperson if needed
        }

        so_response = await zoho_api.create_sales_order(so_data)
        salesorder = so_response.get("salesorder", {})

        # 5. Update our record
        order.zoho_customer_id = zoho_customer_id
        order.zoho_sales_order_id = salesorder.get("salesorder_id")
        order.zoho_sales_order_number = salesorder.get("salesorder_number")
        order.synced_to_zoho_at = datetime.utcnow()
        order.assigned_agent_id = agent_id
        db.commit()

        return {
            "success": True,
            "zoho_sales_order_number": salesorder.get("salesorder_number"),
            "zoho_customer_id": zoho_customer_id,
            "customer_name": customer_name,
            "assigned_agent": agent_id,
            "unmapped_skus": unmapped_skus or None
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Sync failed: {str(e)}")
    finally:
        db.close()


@router.post("/orders/{order_id}/ship")
async def add_shipment_tracking(order_id: str, shipment: ShipmentRequest):
    """Add tracking to a Faire order and optionally push to Faire"""
    db = SessionLocal()
    try:
        order = db.query(FaireOrder).filter(FaireOrder.id == order_id).first()
        if not order:
            raise HTTPException(404, "Order not found")

        order.tracking_number = shipment.tracking_number
        order.carrier = shipment.carrier
        order.shipped_at = datetime.utcnow()

        if shipment.push_to_faire and order.faire_order_id:
            client = get_faire_client(order.brand_name)
            if client:
                try:
                    await client.create_shipment(
                        order_id=order.faire_order_id,
                        tracking_number=shipment.tracking_number,
                        carrier=shipment.carrier
                    )
                    order.tracking_pushed_to_faire = True
                except Exception as e:
                    print(f"FAIRE: Failed to push tracking to Faire: {e}")

        db.commit()
        return {
            "success": True,
            "tracking_number": shipment.tracking_number,
            "carrier": shipment.carrier,
            "pushed_to_faire": order.tracking_pushed_to_faire
        }
    finally:
        db.close()


# ============ Inventory Sync ============

@router.post("/inventory/sync")
async def sync_inventory(request: InventorySyncRequest):
    """Sync inventory levels to Faire for a brand.
    If sku_quantities not provided, fetches from Zoho cache automatically.
    """
    if request.sku_quantities:
        result = await sync_inventory_to_faire(request.brand_name, request.sku_quantities)
    else:
        # Auto-fetch from Zoho
        all_items = await zoho_api.get_all_items_cached()
        brand_items = faire_product_sync.get_active_items_for_brand(all_items, request.brand_name)

        stock_data = {}
        for item in brand_items:
            sku = item.get("sku")
            if not sku:
                continue
            stock = int(item.get("stock_on_hand") or 0)
            # Apply buffer from config
            db = SessionLocal()
            try:
                config = db.query(FaireBrandConfig).filter(
                    FaireBrandConfig.brand_name == request.brand_name
                ).first()
                buffer = int(config.inventory_buffer or 0) if config else 0
            finally:
                db.close()
            stock_data[sku] = max(0, stock - buffer)

        result = await sync_inventory_to_faire(request.brand_name, stock_data)
        result["items_from_zoho"] = len(stock_data)

    return result


# ============ Webhook ============

@router.post("/webhook")
async def faire_webhook(payload: Dict, background_tasks: BackgroundTasks):
    """Receive webhooks from Faire. Register this URL in Faire Brand Portal → Settings → Integrations."""
    webhook_type = payload.get("type", "UNKNOWN")
    order_data = payload.get("order")
    faire_order_id = order_data.get("id") if order_data else None

    log_id = log_webhook(webhook_type, payload, faire_order_id)

    if webhook_type == "ORDER_CREATED" and order_data:
        # Determine brand from token or brand_id in payload
        brand_id = payload.get("brand_id", "")
        brand_name = _resolve_brand_from_faire_id(brand_id)
        background_tasks.add_task(process_faire_order, order_data, brand_name)

    elif webhook_type == "ORDER_UPDATED" and order_data:
        brand_id = payload.get("brand_id", "")
        brand_name = _resolve_brand_from_faire_id(brand_id)
        background_tasks.add_task(process_faire_order, order_data, brand_name)

    return {"received": True, "type": webhook_type, "log_id": log_id}


def _resolve_brand_from_faire_id(faire_brand_id: str) -> str:
    """Map a Faire brand_id to our internal brand_name"""
    # As you add more brands, look up the config table
    db = SessionLocal()
    try:
        configs = db.query(FaireBrandConfig).filter(FaireBrandConfig.is_active == True).all()
        # For now if only one brand is active, return it
        if len(configs) == 1:
            return configs[0].brand_name
        # TODO: Store faire_brand_id in FaireBrandConfig when you have multiple brands
        return "My Flame"
    finally:
        db.close()


# ============ Territory ============

@router.get("/territory/lookup")
async def lookup_territory(postcode: str = Query(...), country: str = Query(default="GB")):
    """Look up which agent covers a postcode"""
    agent_id = get_agent_for_postcode(postcode, country)
    return {"postcode": postcode, "country": country, "agent_id": agent_id}


@router.get("/territory/summary")
async def territory_summary():
    """View the full territory map"""
    return get_territory_summary()


# ============ Debug / Admin ============

@router.get("/webhook-logs")
async def list_webhook_logs(limit: int = 50):
    """View recent webhook logs"""
    db = SessionLocal()
    try:
        logs = db.query(FaireWebhookLog).order_by(
            FaireWebhookLog.created_at.desc()
        ).limit(limit).all()
        return {
            "logs": [
                {
                    "id": log.id,
                    "type": log.webhook_type,
                    "faire_order_id": log.faire_order_id,
                    "processed": log.processed,
                    "error": log.error,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                }
                for log in logs
            ]
        }
    finally:
        db.close()


@router.get("/products/preview/{brand_name}")
async def preview_products(brand_name: str, limit: int = 5):
    """Preview what products would be pushed to Faire (with descriptions generated)"""
    all_items = await zoho_api.get_all_items_cached()
    brand_items = faire_product_sync.get_active_items_for_brand(all_items, brand_name)[:limit]

    previews = []
    for item in brand_items:
        short, full = faire_product_sync.generate_product_description(item, brand_name)
        image_url = faire_product_sync.get_cdn_image_url(item)
        wholesale = float(item.get("rate") or 0)
        multiplier = faire_product_sync.RETAIL_MULTIPLIER.get(brand_name, 2.5)

        previews.append({
            "sku": item.get("sku"),
            "name": item.get("name"),
            "stock": item.get("stock_on_hand"),
            "wholesale_gbp": wholesale,
            "retail_gbp": round(wholesale * multiplier, 2),
            "has_image": bool(image_url),
            "image_url": image_url,
            "short_description": short,
            "full_description": full
        })

    return {"brand": brand_name, "count": len(previews), "products": previews}
