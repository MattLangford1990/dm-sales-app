# Faire API Routes for DM Sales App
# Pilot brand: My Flame

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Dict
from datetime import datetime
import json

from database import (
    SessionLocal, FaireOrder, FaireProductMapping, 
    FaireBrandConfig, FaireWebhookLog
)
import faire_api
from faire_api import (
    FaireClient, get_faire_client, process_faire_order,
    sync_inventory_to_faire, log_webhook, prepare_myflame_product_for_faire
)

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


class FaireWebhookPayload(BaseModel):
    """Incoming webhook from Faire"""
    type: str  # ORDER_CREATED, ORDER_UPDATED, etc.
    order: Optional[Dict] = None
    brand_id: Optional[str] = None


class ManualOrderImport(BaseModel):
    """For manually importing an order by ID"""
    faire_order_id: str
    brand_name: str


class InventorySyncRequest(BaseModel):
    """Request to sync inventory for a brand"""
    brand_name: str
    sku_quantities: Optional[Dict[str, int]] = None  # If None, sync all from Zoho


# ============ Brand Config Endpoints ============

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
    """Add a new brand storefront configuration"""
    db = SessionLocal()
    try:
        # Check if already exists
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
    """Update brand configuration"""
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


@router.delete("/brands/{brand_name}")
async def delete_faire_brand(brand_name: str):
    """Remove brand configuration"""
    db = SessionLocal()
    try:
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == brand_name
        ).first()
        
        if not config:
            raise HTTPException(404, f"Brand {brand_name} not found")
        
        db.delete(config)
        db.commit()
        return {"success": True, "message": f"Brand {brand_name} removed"}
    finally:
        db.close()


@router.post("/brands/{brand_name}/test")
async def test_faire_connection(brand_name: str):
    """Test Faire API connection for a brand"""
    client = get_faire_client(brand_name)
    if not client:
        raise HTTPException(404, f"No active config for {brand_name}")
    
    try:
        # Try to list products to verify connection
        result = await client.list_products(page=1, limit=1)
        return {
            "success": True,
            "message": "Connection successful",
            "product_count": result.get("pagination", {}).get("total", 0)
        }
    except faire_api.FaireAuthError:
        raise HTTPException(401, "Invalid access token")
    except Exception as e:
        raise HTTPException(500, f"Connection failed: {str(e)}")


# ============ Order Endpoints ============

@router.get("/orders")
async def list_faire_orders(
    brand_name: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
):
    """List Faire orders from our database"""
    db = SessionLocal()
    try:
        query = db.query(FaireOrder)
        
        if brand_name:
            query = query.filter(FaireOrder.brand_name == brand_name)
        if status:
            query = query.filter(FaireOrder.faire_state == status)
        
        orders = query.order_by(FaireOrder.created_at.desc()).limit(limit).all()
        
        return {
            "orders": [
                {
                    "id": o.id,
                    "faire_order_id": o.faire_order_id,
                    "brand_name": o.brand_name,
                    "retailer_name": o.retailer_name,
                    "total": o.order_total_cents / 100 if o.order_total_cents else 0,
                    "currency": o.currency,
                    "item_count": o.item_count,
                    "faire_state": o.faire_state,
                    "zoho_sales_order_id": o.zoho_sales_order_id,
                    "zoho_sales_order_number": o.zoho_sales_order_number,
                    "synced_to_zoho": o.synced_to_zoho_at is not None,
                    "assigned_agent": o.assigned_agent_id,
                    "shipped_at": o.shipped_at.isoformat() if o.shipped_at else None,
                    "tracking_number": o.tracking_number,
                    "created_at": o.created_at.isoformat() if o.created_at else None
                }
                for o in orders
            ]
        }
    finally:
        db.close()


@router.get("/orders/{order_id}")
async def get_faire_order(order_id: str):
    """Get a single Faire order by our internal ID"""
    db = SessionLocal()
    try:
        order = db.query(FaireOrder).filter(FaireOrder.id == order_id).first()
        
        if not order:
            raise HTTPException(404, "Order not found")
        
        return {
            "order": {
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
                "total": order.order_total_cents / 100 if order.order_total_cents else 0,
                "currency": order.currency,
                "item_count": order.item_count,
                "items": json.loads(order.order_items_json) if order.order_items_json else [],
                "faire_state": order.faire_state,
                "zoho_customer_id": order.zoho_customer_id,
                "zoho_sales_order_id": order.zoho_sales_order_id,
                "zoho_sales_order_number": order.zoho_sales_order_number,
                "synced_to_zoho_at": order.synced_to_zoho_at.isoformat() if order.synced_to_zoho_at else None,
                "assigned_agent_id": order.assigned_agent_id,
                "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
                "tracking_number": order.tracking_number,
                "carrier": order.carrier,
                "tracking_pushed_to_faire": order.tracking_pushed_to_faire,
                "faire_created_at": order.faire_created_at.isoformat() if order.faire_created_at else None,
                "created_at": order.created_at.isoformat() if order.created_at else None
            }
        }
    finally:
        db.close()


@router.post("/orders/poll")
async def poll_faire_orders(brand_name: str, background_tasks: BackgroundTasks):
    """Manually poll Faire for new orders for a brand"""
    client = get_faire_client(brand_name)
    if not client:
        raise HTTPException(404, f"No active config for {brand_name}")
    
    try:
        # Get orders from last 7 days
        from datetime import timedelta
        result = await client.list_orders(
            page=1,
            limit=50,
            created_at_min=datetime.utcnow() - timedelta(days=7)
        )
        
        orders = result.get("orders", [])
        new_orders = []
        
        for order_data in orders:
            # Process and store order
            order = await process_faire_order(order_data, brand_name)
            if order:
                new_orders.append(order.faire_order_id)
        
        # Update last check time
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
            "orders_checked": len(orders),
            "new_orders": new_orders
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to poll orders: {str(e)}")


@router.post("/orders/{order_id}/sync-to-zoho")
async def sync_order_to_zoho(order_id: str):
    """Create Zoho sales order from Faire order"""
    import zoho_api
    from agents import get_agent_for_postcode  # We'll need to implement this
    
    db = SessionLocal()
    try:
        order = db.query(FaireOrder).filter(FaireOrder.id == order_id).first()
        
        if not order:
            raise HTTPException(404, "Order not found")
        
        if order.synced_to_zoho_at:
            return {
                "success": False,
                "message": "Already synced to Zoho",
                "zoho_sales_order_id": order.zoho_sales_order_id
            }
        
        # 1. Search for or create customer "Faire - [Retailer Name]"
        customer_name = f"Faire - {order.retailer_name}"
        
        # Search for existing customer
        contacts_response = await zoho_api.get_contacts(search=customer_name)
        contacts = contacts_response.get("contacts", [])
        
        zoho_customer_id = None
        
        # Check for exact match
        for contact in contacts:
            if contact.get("company_name") == customer_name or contact.get("contact_name") == customer_name:
                zoho_customer_id = contact.get("contact_id")
                break
        
        # Create if not found
        if not zoho_customer_id:
            # Build shipping address
            address_parts = []
            if order.ship_city:
                address_parts.append(order.ship_city)
            if order.ship_region:
                address_parts.append(order.ship_region)
            if order.ship_postcode:
                address_parts.append(order.ship_postcode)
            if order.ship_country:
                address_parts.append(order.ship_country)
            
            contact_data = {
                "contact_name": customer_name,
                "company_name": customer_name,
                "contact_type": "customer",
                "notes": f"Faire retailer: {order.retailer_name}\nFaire retailer ID: {order.retailer_id or 'N/A'}\nEmail: {order.retailer_email or 'N/A'}"
            }
            
            if order.retailer_email:
                contact_data["email"] = order.retailer_email
            
            if address_parts:
                contact_data["shipping_address"] = {
                    "address": ", ".join(address_parts)
                }
            
            try:
                create_response = await zoho_api.create_contact(contact_data)
                zoho_customer_id = create_response.get("contact", {}).get("contact_id")
            except Exception as e:
                raise HTTPException(500, f"Failed to create Zoho customer: {str(e)}")
        
        if not zoho_customer_id:
            raise HTTPException(500, "Failed to get or create Zoho customer")
        
        # 2. Map line items from Faire SKUs to Zoho item IDs
        order_items = json.loads(order.order_items_json) if order.order_items_json else []
        
        if not order_items:
            raise HTTPException(400, "Order has no line items")
        
        # Get product mapping for this brand
        sku_mapping = faire_api.get_faire_sku_to_zoho_sku(order.brand_name)
        
        # Get all Zoho items to find item_ids by SKU
        all_items = await zoho_api.get_all_items_cached()
        sku_to_item = {item.get("sku"): item for item in all_items if item.get("sku")}
        
        line_items = []
        unmapped_skus = []
        
        for faire_item in order_items:
            faire_sku = faire_item.get("sku") or faire_item.get("product_option", {}).get("sku")
            quantity = faire_item.get("quantity", 1)
            price_cents = faire_item.get("price_cents", 0)
            
            # Try to find Zoho SKU (might be same or mapped)
            zoho_sku = sku_mapping.get(faire_sku, faire_sku)  # Default to same SKU
            
            zoho_item = sku_to_item.get(zoho_sku)
            
            if zoho_item:
                line_items.append({
                    "item_id": zoho_item.get("item_id"),
                    "quantity": quantity,
                    "rate": price_cents / 100  # Convert cents to pounds
                })
            else:
                unmapped_skus.append(faire_sku)
        
        if not line_items:
            raise HTTPException(400, f"No items could be mapped to Zoho. Unmapped SKUs: {unmapped_skus}")
        
        # 3. Create sales order
        # Build notes
        notes_parts = [
            f"Faire Order: {order.faire_order_id}",
            f"Faire Retailer: {order.retailer_name}",
            f"Channel: Faire Marketplace",
            f"Brand: {order.brand_name}"
        ]
        
        if unmapped_skus:
            notes_parts.append(f"Warning: {len(unmapped_skus)} SKUs could not be mapped: {', '.join(unmapped_skus[:5])}")
        
        order_data = {
            "customer_id": zoho_customer_id,
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "line_items": line_items,
            "reference_number": f"FAIRE-{order.faire_order_id[:8]}",
            "notes": "\n".join(notes_parts)
        }
        
        try:
            so_response = await zoho_api.create_sales_order(order_data)
            salesorder = so_response.get("salesorder", {})
        except Exception as e:
            raise HTTPException(500, f"Failed to create Zoho sales order: {str(e)}")
        
        # 4. Update our database record
        order.zoho_customer_id = zoho_customer_id
        order.zoho_sales_order_id = salesorder.get("salesorder_id")
        order.zoho_sales_order_number = salesorder.get("salesorder_number")
        order.synced_to_zoho_at = datetime.utcnow()
        
        # TODO: Assign agent based on postcode/region
        # This would require implementing territory mapping
        
        db.commit()
        
        return {
            "success": True,
            "message": "Order synced to Zoho successfully",
            "zoho_customer_id": zoho_customer_id,
            "zoho_sales_order_id": salesorder.get("salesorder_id"),
            "zoho_sales_order_number": salesorder.get("salesorder_number"),
            "customer_name": customer_name,
            "unmapped_skus": unmapped_skus if unmapped_skus else None
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Sync failed: {str(e)}")
    finally:
        db.close()


# ============ Inventory Endpoints ============

@router.post("/inventory/sync")
async def sync_inventory(request: InventorySyncRequest):
    """Sync inventory levels to Faire for a brand"""
    if not request.sku_quantities:
        # TODO: Get current stock from Zoho/cache
        return {
            "success": False,
            "message": "Auto-fetch from Zoho not yet implemented. Provide sku_quantities."
        }
    
    result = await sync_inventory_to_faire(request.brand_name, request.sku_quantities)
    return result


@router.get("/inventory/{brand_name}")
async def get_faire_inventory(brand_name: str, skus: Optional[str] = None):
    """Get current inventory levels from Faire"""
    client = get_faire_client(brand_name)
    if not client:
        raise HTTPException(404, f"No active config for {brand_name}")
    
    if not skus:
        return {"error": "Provide comma-separated SKUs as query param"}
    
    sku_list = [s.strip() for s in skus.split(",")]
    
    try:
        result = await client.get_inventory_levels(sku_list)
        return result
    except Exception as e:
        raise HTTPException(500, f"Failed to get inventory: {str(e)}")


# ============ Product Mapping Endpoints ============

@router.get("/mappings/{brand_name}")
async def list_product_mappings(brand_name: str, synced_only: bool = False):
    """List SKU mappings for a brand"""
    db = SessionLocal()
    try:
        query = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name
        )
        
        if synced_only:
            query = query.filter(FaireProductMapping.is_synced == True)
        
        mappings = query.all()
        
        return {
            "brand_name": brand_name,
            "total_mappings": len(mappings),
            "mappings": [
                {
                    "zoho_sku": m.zoho_sku,
                    "faire_product_id": m.faire_product_id,
                    "faire_product_option_id": m.faire_product_option_id,
                    "is_synced": m.is_synced,
                    "last_synced_at": m.last_synced_at.isoformat() if m.last_synced_at else None,
                    "sync_error": m.sync_error
                }
                for m in mappings
            ]
        }
    finally:
        db.close()


# ============ Webhook Endpoint ============

@router.post("/webhook")
async def faire_webhook(payload: Dict, background_tasks: BackgroundTasks):
    """Receive webhooks from Faire
    
    Note: You need to configure the webhook URL in Faire's dashboard:
    https://yourdomain.com/api/faire/webhook
    """
    webhook_type = payload.get("type", "UNKNOWN")
    faire_order_id = payload.get("order", {}).get("id") if payload.get("order") else None
    
    # Log the webhook
    log_id = log_webhook(webhook_type, payload, faire_order_id)
    
    # Handle different webhook types
    if webhook_type == "ORDER_CREATED":
        order_data = payload.get("order", {})
        brand_id = payload.get("brand_id")
        
        # Find brand name from brand_id (needs mapping)
        # For now, use My Flame as pilot
        brand_name = "My Flame"  # TODO: Map brand_id to brand_name
        
        # Process in background
        background_tasks.add_task(process_faire_order, order_data, brand_name)
        
        return {"received": True, "webhook_type": webhook_type, "log_id": log_id}
    
    elif webhook_type == "ORDER_UPDATED":
        # TODO: Handle order updates (state changes, etc.)
        return {"received": True, "webhook_type": webhook_type, "log_id": log_id}
    
    else:
        return {"received": True, "webhook_type": webhook_type, "log_id": log_id}


# ============ Debug/Admin Endpoints ============

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


@router.get("/products/{brand_name}/preview")
async def preview_products_for_faire(brand_name: str, limit: int = 10):
    """Preview what products would be synced to Faire"""
    import zoho_api
    
    if brand_name.lower().replace(" ", "") != "myflame":
        return {"error": "Only My Flame is currently supported as pilot brand"}
    
    # Get products from cache
    items = await zoho_api.get_all_items_cached()
    
    preview = []
    for item in items[:500]:  # Check first 500
        faire_product = prepare_myflame_product_for_faire(item)
        if faire_product:
            preview.append({
                "zoho_sku": item.get("sku"),
                "zoho_name": item.get("name"),
                "faire_product": faire_product
            })
            if len(preview) >= limit:
                break
    
    return {
        "brand_name": brand_name,
        "preview_count": len(preview),
        "products": preview
    }
