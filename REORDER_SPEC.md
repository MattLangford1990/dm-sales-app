# Stock Reorder System - Logic Specification
## DM Brands Ltd

---

## OVERVIEW

A demand planning tool for the dm-sales-app admin area. Runs on-demand to identify SKUs that need reordering, grouped by supplier with minimum order thresholds. Includes one-click order creation for both Excel export and Zoho PO.

---

## CORE CALCULATION (Per SKU)

```
Effective Stock = Current stock + Open PO quantity
Weekly Velocity = Same 4-6 week window last year
Weeks of Cover = Effective Stock ÷ Weekly Velocity
Minimum Cover = 5 weeks (3 weeks lead time + 2 weeks buffer)
Reorder Flag = Weeks of Cover < 5 weeks
```

---

## VELOCITY CALCULATION

**Established products (12+ months history):**
- Use same 4-6 week window from previous year
- Captures seasonality (Christmas, gifting peaks)

**New products (less than 12 months history):**
- Flag as "New Product" in report
- Fallback: Last 90 days sales ÷ 13 weeks
- Requires manual review

---

## ANOMALY DETECTION

For the historical window:
- Calculate average sales across all weeks
- If any single week is more than 3x the average, flag as "Anomaly"
- Do not auto-calculate velocity for anomalies
- Requires manual review

---

## SKU STATUS BUCKETS

| Status | Criteria | Velocity Source |
|--------|----------|-----------------|
| Normal | 12+ months history, no anomalies | Same window last year |
| New Product | Less than 12 months history | Last 90 days |
| Anomaly | Any week >3x average | Manual review |

---

## SUPPLIER GROUPING

Once SKUs are flagged for reorder:
1. Group by supplier
2. Sum cost value of flagged items
3. Compare to minimum order threshold
4. If under minimum, show top-up candidates

**Supplier Minimums (all EUR):**
- Räder: €5,000
- Relaxound: €5,000
- Ideas4Seasons: €2,500
- My Flame: €2,500
- PPD: €500
- Elvang: €500

---

## TOP-UP CANDIDATES

When suggested order is below minimum:
- Show other SKUs from that supplier
- Must be below 12 weeks cover (not overstocked)
- Sorted by lowest weeks of cover first
- Helps reach minimum by pulling forward future orders

---

## REPORT OUTPUT EXAMPLE

```
RÄDER (min €5,000)

Reorder Now:
| SKU  | Weeks Cover | Cost Value |
|------|-------------|------------|
| 1234 | 3 weeks     | €450       |
| 5678 | 4 weeks     | €320       |
| Subtotal |         | €3,800     |

Top-up Candidates:
| SKU  | Weeks Cover | Cost Value |
|------|-------------|------------|
| 2345 | 7 weeks     | €280       |
| 3456 | 9 weeks     | €520       |
| 4567 | 11 weeks    | €410       |

Gap to minimum: €1,200
Adding first two top-ups reaches threshold.
```

---

## ORDER CREATION FLOW

From the reorder report:
1. Tick SKUs to include in order
2. Adjust quantities if needed
3. Click "Create Order"

System generates:

**1. Excel file download**
- Filename: [Supplier]_PO_[Date].xlsx
- Columns: SKU | Description | Qty | Unit Price
- You email this to supplier manually

**2. Zoho Purchase Order (created automatically)**
- Supplier name
- Line items: SKU, description, qty, cost price
- Status: Ordered
- Expected delivery: +3 weeks from order date

No more double entry – order once, both systems updated.

---

## DATA REQUIRED FROM ZOHO

1. Current stock levels by SKU
2. Open purchase orders with:
   - PO status (ordered/received)
   - Expected delivery date
   - Quantity per SKU
3. Sales order history:
   - Item-level detail
   - Order dates
   - Quantities sold
4. Purchase order creation API endpoint

---

## IMPLEMENTATION

**Location:** dm-sales-app admin area
**Access:** On-demand (button click)
**Code location:** /Users/matt/Desktop/dm-sales-app/

**Next steps:**
1. ✅ Check existing Zoho API endpoints in zoho_api.py
2. ✅ Add stock, PO, and sales history endpoints if missing
3. ✅ Add PO creation endpoint
4. ✅ Build reorder calculation logic in backend
5. ✅ Add "Stock Reorder" tab to admin frontend
6. ✅ Add Excel export functionality
7. ✅ Wire up "Create Order" button

**ALL IMPLEMENTATION COMPLETE!**
