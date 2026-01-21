# Faire Service - Business logic for Faire integration
# Handles order sync, customer creation, inventory updates, shipment tracking

import json
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple

from faire_api import FaireClient, FaireAPIError, normalize_carrier_code, pounds_to_cents
from database import (
    SessionLocal, 
    FaireOrder, 
    FaireProductMapping, 
    FaireBrandConfig,
    FaireWebhookLog
)


# ============ ORDER PROCESSING ============

async def process_new_faire_orders(brand_name: str) -> Dict[str, Any]:
    """
    Check for new orders from Faire and process them
    
    Returns:
        Dict with results: {
            "orders_found": int,
            "orders_processed": int,
            "errors": list
        }
    """
    db = SessionLocal()
    results = {"orders_found": 0, "orders_processed": 0, "errors": []}
    
    try:
        # Get brand config
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == brand_name
        ).first()
        
        if not config or not config.is_active:
            return {"error": f"Brand {brand_name} not configured or inactive"}
        
        if not config.faire_access_token:
            return {"error": f"No Faire access token for {brand_name}"}
        
        # Create client and fetch new orders
        client = FaireClient(config.faire_access_token, brand_name)
        new_orders = await client.get_new_orders()
        results["orders_found"] = len(new_orders)
        
        for order in new_orders:
            try:
                # Check if we already have this order
                existing = db.query(FaireOrder).filter(
                    FaireOrder.faire_order_id == order["id"]
                ).first()
                
                if existing:
                    continue  # Skip already processed
                
                # Create local order record
                faire_order = create_faire_order_record(order, brand_name, config.faire_access_token)
                db.add(faire_order)
                db.commit()
                
                results["orders_processed"] += 1
                
            except Exception as e:
                results["errors"].append({
                    "order_id": order.get("id"),
                    "error": str(e)
                })
                db.rollback()
        
        # Update last check time
        config.last_order_check = datetime.utcnow()
        db.commit()
        
    except FaireAPIError as e:
        results["errors"].append({"api_error": str(e)})
    except Exception as e:
        results["errors"].append({"error": str(e)})
    finally:
        db.close()
    
    return results


def create_faire_order_record(order_data: dict, brand_name: str, token: str) -> FaireOrder:
    """
    Create a FaireOrder record from Faire API response
    """
    # Extract address info
    address = order_data.get("address", {})
    
    # Extract retailer info
    retailer = order_data.get("retailer", {})
    
    # Calculate totals
    items = order_data.get("items", [])
    total_cents = sum(
        item.get("price_cents", 0) * item.get("quantity", 1) 
        for item in items
    )
    
    return FaireOrder(
        id=str(uuid.uuid4()),
        faire_order_id=order_data["id"],
        faire_brand_token=token,
        brand_name=brand_name,
        
        # Retailer
        retailer_id=retailer.get("id"),
        retailer_name=retailer.get("name", "Unknown Retailer"),
        retailer_email=retailer.get("email"),
        
        # Address
        ship_city=address.get("city"),
        ship_region=address.get("state"),  # Faire uses "state" for region/county
        ship_postcode=address.get("postal_code"),
        ship_country=address.get("country_code", "GB"),
        
        # Order details
        order_total_cents=total_cents,
        currency=order_data.get("currency", "GBP"),
        item_count=len(items),
        order_items_json=json.dumps(items),
        
        # Status
        faire_state=order_data.get("state", "NEW"),
        faire_created_at=parse_faire_datetime(order_data.get("created_at")),
    )


def parse_faire_datetime(dt_string: str) -> Optional[datetime]:
    """Parse Faire's datetime format"""
    if not dt_string:
        return None
    try:
        # Faire uses ISO 8601 format
        return datetime.fromisoformat(dt_string.replace("Z", "+00:00"))
    except:
        return None


# ============ ZOHO INTEGRATION ============

async def sync_faire_order_to_zoho(faire_order_id: str) -> Dict[str, Any]:
    """
    Create Zoho customer and sales order from Faire order
    
    Flow:
    1. Find/create Zoho customer "Faire - [Retailer Name]"
    2. Map Faire product IDs to Zoho SKUs
    3. Create Zoho Sales Order
    4. Accept order on Faire (moves to PROCESSING)
    """
    from zoho_api import (
        get_contacts,
        create_contact,
        create_sales_order,
        get_all_items_cached
    )
    
    db = SessionLocal()
    result = {"success": False}
    
    try:
        # Get the Faire order
        order = db.query(FaireOrder).filter(
            FaireOrder.faire_order_id == faire_order_id
        ).first()
        
        if not order:
            return {"error": f"Faire order {faire_order_id} not found"}
        
        if order.zoho_sales_order_id:
            return {"error": "Order already synced to Zoho", "zoho_order": order.zoho_sales_order_id}
        
        # 1. Find or create Zoho customer
        customer_name = f"Faire - {order.retailer_name}"
        
        # Search for existing customer
        search_result = await get_contacts(search=customer_name)
        existing_customers = search_result.get("contacts", [])
        
        # Look for exact match
        customer_id = None
        for c in existing_customers:
            if c.get("contact_name") == customer_name:
                customer_id = c["contact_id"]
                break
        
        if not customer_id:
            # Create new customer
            customer_data = {
                "contact_name": customer_name,
                "contact_type": "customer",
                "billing_address": {
                    "city": order.ship_city,
                    "state": order.ship_region,
                    "zip": order.ship_postcode,
                    "country": order.ship_country,
                },
                "shipping_address": {
                    "city": order.ship_city,
                    "state": order.ship_region,
                    "zip": order.ship_postcode,
                    "country": order.ship_country,
                },
                "notes": f"Faire retailer ID: {order.retailer_id}",
            }
            
            if order.retailer_email:
                customer_data["email"] = order.retailer_email
            
            new_customer = await create_contact(customer_data)
            customer_id = new_customer["contact"]["contact_id"]
        
        order.zoho_customer_id = customer_id
        
        # 2. Map products and build line items
        order_items = json.loads(order.order_items_json) if order.order_items_json else []
        line_items = []
        
        # Get Zoho items for SKU lookup
        zoho_items = await get_all_items_cached()
        sku_to_zoho = {item["sku"]: item for item in zoho_items}
        
        for item in order_items:
            # Look up our SKU from Faire product ID
            mapping = db.query(FaireProductMapping).filter(
                FaireProductMapping.faire_product_option_id == item.get("product_option_id"),
                FaireProductMapping.brand_name == order.brand_name
            ).first()
            
            if not mapping:
                # Try by product ID if no option mapping
                mapping = db.query(FaireProductMapping).filter(
                    FaireProductMapping.faire_product_id == item.get("product_id"),
                    FaireProductMapping.brand_name == order.brand_name
                ).first()
            
            if mapping and mapping.zoho_item_id:
                line_items.append({
                    "item_id": mapping.zoho_item_id,
                    "quantity": item.get("quantity", 1),
                    "rate": item.get("price_cents", 0) / 100,  # Convert to pounds
                })
            elif mapping and mapping.zoho_sku:
                # Try to find Zoho item by our SKU
                zoho_item = sku_to_zoho.get(mapping.zoho_sku)
                if zoho_item:
                    line_items.append({
                        "item_id": zoho_item["item_id"],
                        "quantity": item.get("quantity", 1),
                        "rate": item.get("price_cents", 0) / 100,
                    })
                else:
                    # SKU not found in Zoho - add as description only
                    line_items.append({
                        "name": f"{item.get('product_name', 'Faire Item')} ({mapping.zoho_sku})",
                        "quantity": item.get("quantity", 1),
                        "rate": item.get("price_cents", 0) / 100,
                    })
            else:
                # No mapping found - use Faire's SKU as fallback
                faire_sku = item.get("sku", "")
                zoho_item = sku_to_zoho.get(faire_sku)
                if zoho_item:
                    line_items.append({
                        "item_id": zoho_item["item_id"],
                        "quantity": item.get("quantity", 1),
                        "rate": item.get("price_cents", 0) / 100,
                    })
                else:
                    line_items.append({
                        "name": f"{item.get('product_name', 'Faire Item')} ({faire_sku})",
                        "quantity": item.get("quantity", 1),
                        "rate": item.get("price_cents", 0) / 100,
                    })
        
        # 3. Create Zoho Sales Order
        sales_order_data = {
            "customer_id": customer_id,
            "reference_number": f"FAIRE-{order.faire_order_id[:8]}",
            "line_items": line_items,
            "notes": f"Faire Order: {order.faire_order_id}\nRetailer: {order.retailer_name}",
            "custom_fields": [
                {"label": "Sales Channel", "value": "Faire"},
                {"label": "Faire Order ID", "value": order.faire_order_id},
            ]
        }
        
        zoho_order = await create_sales_order(sales_order_data)
        
        order.zoho_sales_order_id = zoho_order["salesorder"]["salesorder_id"]
        order.zoho_sales_order_number = zoho_order["salesorder"]["salesorder_number"]
        order.synced_to_zoho_at = datetime.utcnow()
        
        # 4. Assign agent based on territory
        order.assigned_agent_id = determine_agent_for_postcode(order.ship_postcode)
        
        db.commit()
        
        # 5. Accept order on Faire
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == order.brand_name
        ).first()
        
        if config and config.faire_access_token:
            client = FaireClient(config.faire_access_token, order.brand_name)
            await client.accept_order(order.faire_order_id)
            order.faire_state = "PROCESSING"
            db.commit()
        
        result = {
            "success": True,
            "zoho_customer_id": customer_id,
            "zoho_sales_order_id": order.zoho_sales_order_id,
            "zoho_sales_order_number": order.zoho_sales_order_number,
            "assigned_agent": order.assigned_agent_id,
        }
        
    except Exception as e:
        db.rollback()
        result = {"success": False, "error": str(e)}
    finally:
        db.close()
    
    return result


def determine_agent_for_postcode(postcode: str) -> Optional[str]:
    """
    Determine which sales agent covers this postcode area
    
    TODO: Implement actual territory logic based on your agent assignments
    For now, returns None (manual assignment needed)
    """
    if not postcode:
        return None
    
    # Extract postcode area (e.g., "SW1A 1AA" -> "SW")
    postcode_area = postcode.strip().upper().split()[0][:2]
    
    # TODO: Map postcode areas to agents
    # This should match your existing territory assignments
    # Example:
    # AGENT_TERRITORIES = {
    #     "kate.ellis": ["SW", "SE", "BR", "CR", ...],
    #     "nick.barr": ["M", "SK", "WA", ...],
    # }
    
    return None  # Manual assignment for now


# ============ SHIPMENT TRACKING ============

async def push_shipment_to_faire(
    faire_order_id: str,
    tracking_number: str,
    carrier: str = None
) -> Dict[str, Any]:
    """
    Push shipment tracking info to Faire
    
    Call this when order is dispatched in Zoho
    """
    db = SessionLocal()
    
    try:
        order = db.query(FaireOrder).filter(
            FaireOrder.faire_order_id == faire_order_id
        ).first()
        
        if not order:
            return {"error": f"Order {faire_order_id} not found"}
        
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == order.brand_name
        ).first()
        
        if not config or not config.faire_access_token:
            return {"error": "Brand not configured"}
        
        # Normalize carrier name to Faire code
        carrier_code = normalize_carrier_code(carrier)
        
        # Push to Faire
        client = FaireClient(config.faire_access_token, order.brand_name)
        await client.create_shipment(
            order_id=faire_order_id,
            tracking_number=tracking_number,
            carrier_code=carrier_code
        )
        
        # Update our record
        order.shipped_at = datetime.utcnow()
        order.tracking_number = tracking_number
        order.carrier = carrier
        order.tracking_pushed_to_faire = True
        order.faire_state = "PRE_TRANSIT"
        db.commit()
        
        return {"success": True, "tracking_number": tracking_number}
        
    except FaireAPIError as e:
        return {"error": f"Faire API error: {e.message}"}
    except Exception as e:
        db.rollback()
        return {"error": str(e)}
    finally:
        db.close()


# ============ INVENTORY SYNC ============

async def sync_inventory_to_faire(brand_name: str) -> Dict[str, Any]:
    """
    Push current inventory levels to Faire
    
    - Gets stock from Zoho (via cached items)
    - Applies any buffer/rules
    - Bulk updates Faire
    """
    from zoho_api import get_all_items_cached
    
    db = SessionLocal()
    result = {"updated": 0, "errors": []}
    
    try:
        config = db.query(FaireBrandConfig).filter(
            FaireBrandConfig.brand_name == brand_name
        ).first()
        
        if not config or not config.is_active or not config.sync_inventory:
            return {"error": "Inventory sync not enabled for this brand"}
        
        # Get all product mappings for this brand
        mappings = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.is_synced == True,
            FaireProductMapping.faire_product_option_id.isnot(None)
        ).all()
        
        if not mappings:
            return {"error": "No synced products found for this brand"}
        
        # Get current Zoho inventory
        zoho_items = await get_all_items_cached()
        sku_to_stock = {item["sku"]: item.get("stock_on_hand", 0) for item in zoho_items}
        
        # Build bulk update
        inventory_updates = []
        buffer = config.inventory_buffer or 0
        
        for mapping in mappings:
            stock = sku_to_stock.get(mapping.zoho_sku, 0)
            
            # Apply buffer
            available = max(0, int(stock) - buffer)
            
            inventory_updates.append({
                "product_option_id": mapping.faire_product_option_id,
                "available_quantity": available
            })
        
        # Push to Faire in batches (API may have limits)
        client = FaireClient(config.faire_access_token, brand_name)
        batch_size = 100
        
        for i in range(0, len(inventory_updates), batch_size):
            batch = inventory_updates[i:i + batch_size]
            try:
                await client.bulk_update_inventory(batch)
                result["updated"] += len(batch)
            except FaireAPIError as e:
                result["errors"].append(f"Batch {i//batch_size}: {e.message}")
        
        # Update last sync time
        config.last_inventory_sync = datetime.utcnow()
        db.commit()
        
    except Exception as e:
        result["errors"].append(str(e))
    finally:
        db.close()
    
    return result


# ============ WEBHOOK HANDLING ============

def log_webhook(webhook_type: str, order_id: str, payload: dict) -> str:
    """Log incoming webhook for debugging"""
    db = SessionLocal()
    try:
        log = FaireWebhookLog(
            id=str(uuid.uuid4()),
            webhook_type=webhook_type,
            faire_order_id=order_id,
            payload_json=json.dumps(payload)
        )
        db.add(log)
        db.commit()
        return log.id
    finally:
        db.close()


async def process_webhook(webhook_type: str, payload: dict) -> Dict[str, Any]:
    """
    Process incoming Faire webhook
    
    Webhook types:
    - BRAND_ORDER_CREATED: New order
    - BRAND_ORDER_UPDATED: Order status changed
    - BRAND_ORDER_BACKORDERED: Items backordered
    - BRAND_ORDER_CANCELED: Order canceled
    """
    log_id = log_webhook(webhook_type, payload.get("order_id"), payload)
    
    db = SessionLocal()
    try:
        if webhook_type == "BRAND_ORDER_CREATED":
            # New order - fetch full details and create record
            order_id = payload.get("order_id")
            brand_token = payload.get("brand_token")  # If provided
            
            # We need to fetch the full order since webhook may have limited data
            # For now, mark as needing processing
            return {"webhook_logged": log_id, "action": "fetch_order_details"}
            
        elif webhook_type == "BRAND_ORDER_CANCELED":
            order_id = payload.get("order_id")
            order = db.query(FaireOrder).filter(
                FaireOrder.faire_order_id == order_id
            ).first()
            
            if order:
                order.faire_state = "CANCELED"
                db.commit()
                # TODO: Cancel Zoho order if not shipped
                
            return {"webhook_logged": log_id, "action": "order_canceled"}
        
        # Mark webhook as processed
        webhook_log = db.query(FaireWebhookLog).filter(
            FaireWebhookLog.id == log_id
        ).first()
        if webhook_log:
            webhook_log.processed = True
            db.commit()
        
        return {"webhook_logged": log_id, "processed": True}
        
    except Exception as e:
        # Log error
        webhook_log = db.query(FaireWebhookLog).filter(
            FaireWebhookLog.id == log_id
        ).first()
        if webhook_log:
            webhook_log.error = str(e)
            db.commit()
        return {"error": str(e), "webhook_logged": log_id}
    finally:
        db.close()
