# Stock Reorder System - Implementation Summary

## Files Created/Modified

### New Files

**`backend/reorder_service.py`**
Core reorder calculation logic including:
- `SKUStatus` enum: NORMAL, NEW_PRODUCT, ANOMALY, NO_SALES
- `SKUAnalysis` dataclass: Complete analysis for each SKU
- `SupplierOrder` dataclass: Grouped orders by supplier
- `SUPPLIER_MINIMUMS`: Configured thresholds for each supplier
- `get_velocity_window_dates()`: Calculates same 4-6 week window from last year
- `detect_anomalies()`: Flags weeks >3x average
- `calculate_suggested_qty()`: Determines order quantity to reach target cover
- `run_reorder_analysis()`: Main entry point - runs full analysis
- `format_analysis_report()`: Formats results for API response

### Modified Files

**`backend/zoho_api.py`** - Added:
- Purchase Orders: `get_purchase_orders()`, `get_purchase_order()`, `get_all_open_purchase_orders()`, `create_purchase_order()`
- Vendors: `get_vendors()`, `get_all_vendors()`
- Sales History: `get_sales_orders_by_date_range()`, `get_invoices_by_date_range()`, `get_invoice()`, `get_sales_by_item_report()`

**`backend/main.py`** - Added endpoints:
- `GET /api/admin/reorder/analysis` - Run full reorder analysis
- `POST /api/admin/reorder/create-po` - Create Zoho purchase order
- `POST /api/admin/reorder/export-excel` - Download Excel PO file
- `GET /api/admin/reorder/vendors` - List suppliers from Zoho
- `GET /api/admin/reorder/open-pos` - List open purchase orders

---

## API Usage

### Run Analysis
```
GET /api/admin/reorder/analysis
GET /api/admin/reorder/analysis?brands=Räder,Relaxound
```

Returns:
```json
{
  "generated_at": "2025-12-21T10:00:00",
  "summary": {
    "total_reorder_value_eur": 15420.50,
    "total_reorder_skus": 47,
    "supplier_count": 4,
    "suppliers_below_minimum": 1
  },
  "suppliers": [
    {
      "supplier": "Räder",
      "minimum_eur": 5000,
      "reorder_total_eur": 3800,
      "gap_to_minimum": 1200,
      "meets_minimum": false,
      "reorder_items": [...],
      "topup_candidates": [...]
    }
  ]
}
```

### Create Purchase Order
```
POST /api/admin/reorder/create-po
{
  "supplier": "Räder",
  "items": [
    {"sku": "1234", "item_id": "xyz", "quantity": 50, "cost_price": 9.00}
  ],
  "notes": "Optional notes"
}
```

### Export Excel
```
POST /api/admin/reorder/export-excel
{
  "supplier": "Räder",
  "items": [...],
  "notes": "Optional notes"
}
```
Returns downloadable Excel file.

---

## Supplier Minimums (EUR)

| Supplier | Minimum |
|----------|---------|
| Räder | €5,000 |
| Relaxound | €5,000 |
| Ideas4Seasons | €2,500 |
| My Flame | €2,500 |
| PPD | €500 |
| Elvang | €500 |

---

## Next Steps

1. **Test the API endpoints** - Run locally and test the analysis
2. **Check Zoho API permissions** - Ensure refresh token has access to:
   - Purchase orders (read/write)
   - Invoices (read)
   - Contacts/Vendors (read)
3. **Build frontend admin tab** - React component for the reorder interface
4. **Tune velocity calculation** - Adjust window size if needed based on your sales patterns
5. **Add pack quantity handling** - May need to round up to pack quantities

---

## Testing Locally

```bash
cd /Users/matt/Desktop/dm-sales-app/backend
source venv/bin/activate
python -m uvicorn main:app --reload

# Test the analysis endpoint:
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/admin/reorder/analysis
```
