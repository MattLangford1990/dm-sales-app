# Faire Integration for DM Brands - Implementation Summary

## Overview
Integration between Faire wholesale marketplace and dm-sales-app, with My Flame as the pilot brand.

## Architecture
```
Faire Marketplace → dm-sales-app (PostgreSQL) → Zoho Inventory
                          ↓
                    Agent Commission System
```

## Files Created

### 1. `/backend/faire_api.py`
Core Faire API client and helper functions:
- `FaireClient` - Async HTTP client for Faire API v2
- Product CRUD operations
- Inventory sync (bulk updates)
- Order retrieval and acceptance
- Shipment creation with tracking
- Exception classes for error handling
- `process_faire_order()` - Process incoming Faire orders
- `sync_inventory_to_faire()` - Bulk inventory sync
- `prepare_myflame_product_for_faire()` - Transform Zoho items to Faire format

### 2. `/backend/faire_routes.py`
FastAPI router with endpoints at `/api/faire/`:

**Brand Config:**
- `GET /brands` - List all configured Faire brands
- `POST /brands` - Add new brand config
- `PUT /brands/{brand_name}` - Update brand config
- `DELETE /brands/{brand_name}` - Remove brand config
- `POST /brands/{brand_name}/test` - Test API connection

**Orders:**
- `GET /orders` - List Faire orders (with filters)
- `GET /orders/{order_id}` - Get single order details
- `POST /orders/poll` - Poll Faire for new orders
- `POST /orders/{order_id}/sync-to-zoho` - Create Zoho sales order

**Inventory:**
- `POST /inventory/sync` - Sync inventory levels to Faire
- `GET /inventory/{brand_name}` - Get current Faire inventory

**Product Mapping:**
- `GET /mappings/{brand_name}` - List SKU mappings

**Webhook:**
- `POST /webhook` - Receive Faire webhooks

**Debug:**
- `GET /webhook-logs` - View webhook history
- `GET /products/{brand_name}/preview` - Preview products for sync

### 3. Database Models (in `/backend/database.py`)
Already existed:
- `FaireOrder` - Track orders from Faire
- `FaireProductMapping` - SKU mapping between Zoho and Faire
- `FaireBrandConfig` - Per-brand API credentials and settings
- `FaireWebhookLog` - Webhook debugging

### 4. Main.py Updates
- Added `import faire_routes`
- Added `app.include_router(faire_routes.router)`

## Key Decisions Implemented

1. **Customer Creation**: Each Faire retailer gets a new Zoho customer: "Faire - [Retailer Name]"
2. **Agent Commission**: Orders route to territorial agent (placeholder for postcode lookup)
3. **Pilot Brand**: My Flame - `prepare_myflame_product_for_faire()` function ready

## Next Steps to Complete

### Immediate (Before Go-Live)
1. **Get Faire API Token**
   - Apply at https://faire.com/brand-portal
   - Create My Flame storefront
   - Get X-FAIRE-ACCESS-TOKEN

2. **Configure Brand in Database**
   ```bash
   # Via API endpoint
   POST /api/faire/brands
   {
     "brand_name": "My Flame",
     "faire_access_token": "YOUR_TOKEN",
     "is_active": true
   }
   ```

3. **Initial Product Sync**
   - Test with `/api/faire/products/myflame/preview`
   - Build proper product push to Faire

4. **Set Up Webhooks**
   - Configure in Faire dashboard: `https://dm-sales-app.onrender.com/api/faire/webhook`
   - Events: ORDER_CREATED, ORDER_UPDATED

### Medium Term
1. **Territory Agent Mapping**
   - Implement postcode → agent lookup
   - Add `get_agent_for_postcode()` function

2. **Scheduled Inventory Sync**
   - Add cron endpoint for hourly inventory push
   - Apply Räder ≤9=0 rule for Räder (when expanded)

3. **Shipment Tracking**
   - Hook into Zoho shipment events
   - Push tracking to Faire API

### Expansion
1. **Add More Brands**
   - Räder, Remember, PPD, Ideas4Seasons
   - Each needs its own Faire storefront token

## API Quick Reference

### Test Connection
```bash
curl -X POST https://dm-sales-app.onrender.com/api/faire/brands/My%20Flame/test
```

### Poll for Orders
```bash
curl -X POST "https://dm-sales-app.onrender.com/api/faire/orders/poll?brand_name=My%20Flame"
```

### Sync Order to Zoho
```bash
curl -X POST https://dm-sales-app.onrender.com/api/faire/orders/{order_id}/sync-to-zoho
```

### Sync Inventory
```bash
curl -X POST https://dm-sales-app.onrender.com/api/faire/inventory/sync \
  -H "Content-Type: application/json" \
  -d '{"brand_name": "My Flame", "sku_quantities": {"SKU001": 50, "SKU002": 25}}'
```

## Environment Variables Needed
```bash
# Add to .env (no new vars needed - uses existing Zoho creds)
# Faire tokens stored in database via FaireBrandConfig
```

## Faire API Notes
- API Base: https://www.faire.com/external-api/v2
- Auth: X-FAIRE-ACCESS-TOKEN header
- Rate limits: Be respectful, batch inventory updates
- Inventory accepts up to 100 SKUs per request
- Commission: 15% marketplace, 0% Faire Direct

## Testing Checklist
- [ ] Test API connection with token
- [ ] Preview My Flame products for sync
- [ ] Test webhook endpoint receives data
- [ ] Test order processing creates FaireOrder record
- [ ] Test Zoho customer creation ("Faire - [Name]")
- [ ] Test Zoho sales order creation
- [ ] Test inventory sync to Faire
