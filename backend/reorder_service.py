"""
Stock Reorder Service
=====================
Demand planning and reorder calculation for DM Brands.

Core Logic:
- Effective Stock = Current stock + Open PO quantity
- Weekly Velocity = Same 4-6 week window from previous year (seasonality)
- Weeks of Cover = Effective Stock ÷ Weekly Velocity
- Reorder Flag = Weeks of Cover < 5 weeks (3 weeks lead + 2 weeks buffer)
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
import asyncio
import zoho_api


class SKUStatus(str, Enum):
    NORMAL = "normal"           # 12+ months history, no anomalies
    NEW_PRODUCT = "new"         # Less than 12 months history
    ANOMALY = "anomaly"         # Any week >3x average - needs manual review
    NO_SALES = "no_sales"       # No sales history at all


@dataclass
class SKUAnalysis:
    """Analysis result for a single SKU"""
    sku: str
    item_id: str
    name: str
    brand: str
    supplier: str
    
    # Stock levels
    current_stock: int
    committed_stock: int
    available_stock: int
    open_po_qty: int
    effective_stock: int
    
    # Velocity
    weekly_velocity: float
    velocity_source: str  # "last_year" or "90_day_average"
    
    # Cover calculation
    weeks_of_cover: float
    needs_reorder: bool
    
    # Status and flags
    status: SKUStatus
    anomaly_weeks: List[str] = field(default_factory=list)
    
    # Cost info
    cost_price: float = 0
    suggested_qty: int = 0
    order_value: float = 0
    
    # First sale date (for new product detection)
    first_sale_date: Optional[str] = None


@dataclass
class SupplierOrder:
    """Grouped order for a supplier"""
    supplier_name: str
    supplier_id: Optional[str]
    minimum_order_eur: float
    
    # Items to reorder (below 5 weeks cover)
    reorder_items: List[SKUAnalysis]
    reorder_total_eur: float
    
    # Top-up candidates (5-12 weeks cover)
    topup_candidates: List[SKUAnalysis]
    
    # Gap to minimum
    gap_to_minimum: float
    meets_minimum: bool


# Supplier configuration - order minimums in EUR
SUPPLIER_MINIMUMS = {
    "Räder": 5000,
    "Raeder": 5000,  # Alternative spelling
    "räder": 5000,
    "Relaxound": 5000,
    "Ideas4Seasons": 2500,
    "My Flame": 2500,
    "My Flame Lifestyle": 2500,
    "PPD": 500,
    "Paper Products Design": 500,
    "Elvang": 500,
}

# Minimum weeks of cover before reorder
MIN_COVER_WEEKS = 5  # 3 weeks lead time + 2 weeks buffer

# Top-up candidate threshold
TOPUP_MAX_WEEKS = 12  # Include items with less than 12 weeks cover as top-ups

# Anomaly detection threshold
ANOMALY_MULTIPLIER = 3  # Flag if any week > 3x average


def get_supplier_minimum(supplier_name: str) -> float:
    """Get minimum order value for a supplier"""
    # Try exact match first
    if supplier_name in SUPPLIER_MINIMUMS:
        return SUPPLIER_MINIMUMS[supplier_name]
    
    # Try case-insensitive partial match
    supplier_lower = supplier_name.lower()
    for key, value in SUPPLIER_MINIMUMS.items():
        if key.lower() in supplier_lower or supplier_lower in key.lower():
            return value
    
    # Default minimum if not found
    return 500


def get_velocity_window_dates(weeks_offset: int = 0) -> Tuple[str, str]:
    """
    Calculate the date range for velocity calculation.
    
    Uses the same 4-6 week window from the previous year to capture seasonality.
    
    Args:
        weeks_offset: Weeks from now to center the window (default 0 = current week)
    
    Returns:
        Tuple of (start_date, end_date) in YYYY-MM-DD format
    """
    today = datetime.now()
    
    # Go back one year
    last_year = today.replace(year=today.year - 1)
    
    # Apply offset
    center_date = last_year + timedelta(weeks=weeks_offset)
    
    # Create 6-week window centered on this date
    # (3 weeks before, 3 weeks after = 6 week window)
    start_date = center_date - timedelta(weeks=3)
    end_date = center_date + timedelta(weeks=3)
    
    return start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d")


def get_90_day_window_dates() -> Tuple[str, str]:
    """Get date range for last 90 days (fallback for new products)"""
    today = datetime.now()
    start_date = today - timedelta(days=90)
    return start_date.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")


def detect_anomalies(weekly_sales: Dict[str, int]) -> Tuple[bool, List[str]]:
    """
    Detect anomalous weeks in sales data.
    
    Args:
        weekly_sales: Dict of {week_string: quantity_sold}
    
    Returns:
        Tuple of (has_anomaly, list_of_anomaly_weeks)
    """
    if not weekly_sales:
        return False, []
    
    values = list(weekly_sales.values())
    if not values or all(v == 0 for v in values):
        return False, []
    
    # Calculate average (excluding zeros for better detection)
    non_zero = [v for v in values if v > 0]
    if not non_zero:
        return False, []
    
    average = sum(non_zero) / len(non_zero)
    threshold = average * ANOMALY_MULTIPLIER
    
    anomaly_weeks = []
    for week, qty in weekly_sales.items():
        if qty > threshold:
            anomaly_weeks.append(week)
    
    return len(anomaly_weeks) > 0, anomaly_weeks


def calculate_suggested_qty(
    weekly_velocity: float,
    effective_stock: int,
    target_weeks: int = 12
) -> int:
    """
    Calculate suggested order quantity.
    
    Aims to bring stock up to target_weeks of cover.
    """
    if weekly_velocity <= 0:
        return 0
    
    target_stock = weekly_velocity * target_weeks
    suggested = target_stock - effective_stock
    
    # Round up to nearest whole number
    return max(0, int(suggested + 0.5))


def map_brand_to_supplier(brand: str) -> str:
    """
    Map a brand name to its supplier.
    
    In most cases brand = supplier, but handles variations.
    """
    brand_lower = brand.lower() if brand else ""
    
    # Direct mappings
    mappings = {
        "räder": "Räder",
        "raeder": "Räder",
        "rader": "Räder",
        "ppd": "PPD",
        "paper products design": "PPD",
        "my flame": "My Flame",
        "my flame lifestyle": "My Flame",
        "ideas4seasons": "Ideas4Seasons",
        "relaxound": "Relaxound",
        "elvang": "Elvang",
        "gefu": "GEFU",
        "remember": "Remember",
    }
    
    for key, value in mappings.items():
        if key in brand_lower:
            return value
    
    # Return original if no mapping found
    return brand or "Unknown"


async def get_open_po_quantities() -> Dict[str, int]:
    """
    Get quantity on open purchase orders by SKU.
    
    Returns dict of {sku: total_open_qty}
    """
    po_quantities = {}
    
    try:
        open_pos = await zoho_api.get_all_open_purchase_orders()
        
        for po in open_pos:
            for line_item in po.get("line_items", []):
                sku = line_item.get("sku", "")
                if sku:
                    # Quantity ordered minus quantity received
                    ordered = line_item.get("quantity", 0)
                    received = line_item.get("quantity_received", 0)
                    pending = ordered - received
                    
                    if pending > 0:
                        po_quantities[sku] = po_quantities.get(sku, 0) + pending
        
        print(f"REORDER: Found {len(po_quantities)} SKUs with open PO quantities")
    except Exception as e:
        print(f"REORDER ERROR: Failed to get open POs: {e}")
    
    return po_quantities


async def fetch_invoice_line_items(invoice_id: str) -> List[dict]:
    """Fetch line items for a single invoice"""
    try:
        full_invoice = await zoho_api.get_invoice(invoice_id)
        return full_invoice.get("invoice", {}).get("line_items", [])
    except Exception as e:
        print(f"REORDER: Error fetching invoice {invoice_id}: {e}")
        return []


async def get_sales_velocity_data(start_date: str, end_date: str) -> Dict[str, Dict]:
    """
    Get sales data broken down by week for each SKU.
    Uses parallel fetching for speed.
    
    Returns dict of {sku: {"total": qty_sold}}
    """
    velocity_data = {}
    
    try:
        # Get invoices list
        print(f"REORDER: Fetching invoices from {start_date} to {end_date}...")
        invoices = await zoho_api.get_invoices_by_date_range(start_date, end_date)
        print(f"REORDER: Got {len(invoices)} invoices, fetching line items in parallel...")
        
        if not invoices:
            print("REORDER WARNING: No invoices found in date range!")
            return velocity_data
        
        # Get invoice IDs
        invoice_ids = [inv.get("invoice_id") for inv in invoices if inv.get("invoice_id")]
        
        # Fetch all invoices in parallel (batches of 20 to avoid overwhelming API)
        batch_size = 20
        all_line_items = []
        
        for i in range(0, len(invoice_ids), batch_size):
            batch = invoice_ids[i:i+batch_size]
            print(f"REORDER: Fetching batch {i//batch_size + 1}/{(len(invoice_ids) + batch_size - 1)//batch_size}...")
            
            # Fetch batch in parallel
            batch_results = await asyncio.gather(*[
                fetch_invoice_line_items(inv_id) for inv_id in batch
            ])
            
            for line_items in batch_results:
                all_line_items.extend(line_items)
        
        # Aggregate by SKU
        for line_item in all_line_items:
            sku = line_item.get("sku", "")
            qty = line_item.get("quantity", 0)
            
            if sku and qty > 0:
                if sku not in velocity_data:
                    velocity_data[sku] = {"total": 0}
                velocity_data[sku]["total"] += qty
        
        print(f"REORDER: Got velocity data for {len(velocity_data)} SKUs from {len(invoices)} invoices")
        
        # Debug: show top 5 SKUs by velocity
        if velocity_data:
            top_skus = sorted(velocity_data.items(), key=lambda x: x[1].get("total", 0), reverse=True)[:5]
            print(f"REORDER: Top 5 SKUs by velocity: {[(s, d['total']) for s, d in top_skus]}")
        
    except Exception as e:
        print(f"REORDER ERROR: Failed to get velocity data: {e}")
        import traceback
        traceback.print_exc()
    
    return velocity_data




async def analyze_sku(
    item: dict,
    po_quantities: Dict[str, int],
    velocity_data_last_year: Dict[str, Dict],
    velocity_data_90_day: Dict[str, Dict],
    first_sale_dates: Dict[str, str]
) -> Optional[SKUAnalysis]:
    """
    Analyze a single SKU for reorder.
    
    Returns SKUAnalysis or None if SKU should be skipped.
    """
    sku = item.get("sku", "")
    if not sku:
        return None
    
    # Skip inactive items
    if item.get("status") == "inactive":
        return None
    
    # Basic info - account for committed stock (allocated to open sales orders)
    stock_on_hand = item.get("stock_on_hand", 0) or 0
    committed_stock = item.get("committed_stock", 0) or item.get("stock_committed", 0) or 0
    current_stock = stock_on_hand  # For display
    available_stock = stock_on_hand - committed_stock
    open_po = po_quantities.get(sku, 0)
    effective_stock = available_stock + open_po
    
    brand = item.get("brand") or item.get("manufacturer") or ""
    supplier = map_brand_to_supplier(brand)
    cost_price = item.get("purchase_rate", 0) or item.get("purchase_price", 0) or 0
    
    # Determine product status and velocity
    first_sale = first_sale_dates.get(sku)
    
    # Check if product is new (less than 12 months history)
    is_new_product = False
    if first_sale:
        try:
            first_sale_date = datetime.strptime(first_sale, "%Y-%m-%d")
            months_since_first_sale = (datetime.now() - first_sale_date).days / 30
            is_new_product = months_since_first_sale < 12
        except:
            pass
    
    # Get velocity data
    velocity_source = "last_year"
    weekly_velocity = 0
    status = SKUStatus.NORMAL
    anomaly_weeks = []
    
    if sku in velocity_data_last_year:
        weekly_sales = velocity_data_last_year[sku]
        
        # Check for anomalies
        has_anomaly, anomaly_weeks = detect_anomalies(weekly_sales)
        
        if has_anomaly:
            status = SKUStatus.ANOMALY
            # Don't auto-calculate velocity for anomalies
            weekly_velocity = 0
        else:
            # Calculate weekly velocity from last year's data
            if "total" in weekly_sales:
                # Report format - total over ~6 weeks
                weekly_velocity = weekly_sales["total"] / 6
            else:
                # Invoice format - sum and divide by weeks
                total_qty = sum(weekly_sales.values())
                num_weeks = max(len(weekly_sales), 1)
                weekly_velocity = total_qty / num_weeks
    
    # Fallback for new products or missing last year data
    if is_new_product or (weekly_velocity == 0 and status != SKUStatus.ANOMALY):
        if sku in velocity_data_90_day:
            status = SKUStatus.NEW_PRODUCT
            velocity_source = "90_day_average"
            
            weekly_sales_90 = velocity_data_90_day[sku]
            if "total" in weekly_sales_90:
                weekly_velocity = weekly_sales_90["total"] / 13  # 90 days ≈ 13 weeks
            else:
                total_qty = sum(weekly_sales_90.values())
                weekly_velocity = total_qty / 13
        elif weekly_velocity == 0 and status == SKUStatus.NORMAL:
            status = SKUStatus.NO_SALES
    
    # Calculate weeks of cover
    if weekly_velocity > 0:
        weeks_of_cover = effective_stock / weekly_velocity
    else:
        # If no velocity, treat as infinite cover (don't auto-reorder)
        weeks_of_cover = 999
    
    # Determine if reorder needed
    needs_reorder = weeks_of_cover < MIN_COVER_WEEKS and status == SKUStatus.NORMAL
    
    # Calculate suggested quantity
    suggested_qty = 0
    if needs_reorder:
        suggested_qty = calculate_suggested_qty(weekly_velocity, effective_stock)
    
    order_value = suggested_qty * cost_price
    
    return SKUAnalysis(
        sku=sku,
        item_id=item.get("item_id", ""),
        name=item.get("name", ""),
        brand=brand,
        supplier=supplier,
        current_stock=current_stock,
        committed_stock=committed_stock,
        available_stock=available_stock,
        open_po_qty=open_po,
        effective_stock=effective_stock,
        weekly_velocity=round(weekly_velocity, 2),
        velocity_source=velocity_source,
        weeks_of_cover=round(weeks_of_cover, 1),
        needs_reorder=needs_reorder,
        status=status,
        anomaly_weeks=anomaly_weeks,
        cost_price=cost_price,
        suggested_qty=suggested_qty,
        order_value=round(order_value, 2),
        first_sale_date=first_sale
    )


def group_by_supplier(analyses: List[SKUAnalysis]) -> Dict[str, SupplierOrder]:
    """
    Group SKU analyses by supplier and calculate order totals.
    """
    supplier_groups = {}
    
    for analysis in analyses:
        supplier = analysis.supplier
        
        if supplier not in supplier_groups:
            supplier_groups[supplier] = SupplierOrder(
                supplier_name=supplier,
                supplier_id=None,  # Can be populated from Zoho vendor lookup
                minimum_order_eur=get_supplier_minimum(supplier),
                reorder_items=[],
                reorder_total_eur=0,
                topup_candidates=[],
                gap_to_minimum=0,
                meets_minimum=False
            )
        
        group = supplier_groups[supplier]
        
        if analysis.needs_reorder:
            group.reorder_items.append(analysis)
            group.reorder_total_eur += analysis.order_value
        elif analysis.weeks_of_cover < TOPUP_MAX_WEEKS and analysis.status == SKUStatus.NORMAL:
            # Potential top-up candidate
            # Recalculate suggested qty to bring to 12 weeks
            if analysis.weekly_velocity > 0:
                analysis.suggested_qty = calculate_suggested_qty(
                    analysis.weekly_velocity,
                    analysis.effective_stock,
                    target_weeks=12
                )
                analysis.order_value = round(analysis.suggested_qty * analysis.cost_price, 2)
            group.topup_candidates.append(analysis)
    
    # Calculate gaps and sort
    for supplier, group in supplier_groups.items():
        # Sort reorder items by weeks of cover (lowest first)
        group.reorder_items.sort(key=lambda x: x.weeks_of_cover)
        
        # Sort top-up candidates by weeks of cover (lowest first)
        group.topup_candidates.sort(key=lambda x: x.weeks_of_cover)
        
        # Calculate gap to minimum
        group.gap_to_minimum = max(0, group.minimum_order_eur - group.reorder_total_eur)
        group.meets_minimum = group.reorder_total_eur >= group.minimum_order_eur
    
    return supplier_groups




async def analyze_sku_quick(
    item: dict,
    po_quantities: Dict[str, int]
) -> Optional[SKUAnalysis]:
    """
    Quick analysis - just check stock levels without velocity calculation.
    Uses a simple threshold of 20 units.
    """
    sku = item.get("sku", "")
    if not sku:
        return None
    
    # Skip inactive items
    if item.get("status") == "inactive":
        return None
    
    # Basic info - account for committed stock
    stock_on_hand = item.get("stock_on_hand", 0) or 0
    committed_stock = item.get("committed_stock", 0) or item.get("stock_committed", 0) or 0
    current_stock = stock_on_hand
    available_stock = stock_on_hand - committed_stock
    open_po = po_quantities.get(sku, 0)
    effective_stock = available_stock + open_po
    
    brand = item.get("brand") or item.get("manufacturer") or ""
    supplier = map_brand_to_supplier(brand)
    cost_price = item.get("purchase_rate", 0) or item.get("purchase_price", 0) or 0
    
    # Skip items with no brand/supplier
    if not brand or supplier == "Unknown":
        return None
    
    # Simple threshold: need reorder if effective stock < 20
    # Estimate 4 units/week velocity, so 20 = 5 weeks cover
    estimated_velocity = 4.0
    weeks_of_cover = effective_stock / estimated_velocity if estimated_velocity > 0 else 999
    needs_reorder = effective_stock < 20 and effective_stock >= 0
    
    # Calculate suggested quantity to reach 50 units (12 weeks at 4/week)
    suggested_qty = max(0, 50 - effective_stock) if needs_reorder else 0
    order_value = round(suggested_qty * cost_price, 2)
    
    return SKUAnalysis(
        sku=sku,
        item_id=item.get("item_id", ""),
        name=item.get("name", ""),
        brand=brand,
        supplier=supplier,
        current_stock=current_stock,
        committed_stock=committed_stock,
        available_stock=available_stock,
        open_po_qty=open_po,
        effective_stock=effective_stock,
        weekly_velocity=estimated_velocity,
        velocity_source="estimated",
        weeks_of_cover=round(weeks_of_cover, 1),
        needs_reorder=needs_reorder,
        status=SKUStatus.NORMAL,
        anomaly_weeks=[],
        cost_price=cost_price,
        suggested_qty=suggested_qty,
        order_value=order_value,
        first_sale_date=None
    )


async def run_reorder_analysis(
    brand_filter: Optional[List[str]] = None,
    quick_mode: bool = False
) -> Dict[str, SupplierOrder]:
    """
    Run full reorder analysis.
    
    Args:
        brand_filter: Optional list of brands to analyze (None = all brands)
        quick_mode: If True, skip velocity calculation and use simple stock threshold
    
    Returns:
        Dict of supplier_name -> SupplierOrder
    """
    print(f"REORDER: Starting analysis (quick_mode={quick_mode})...")
    
    # 1. Get all items from Zoho
    all_items = await zoho_api.get_all_items_cached()
    print(f"REORDER: Loaded {len(all_items)} items from Zoho")
    
    # 2. Filter by brand if specified
    if brand_filter:
        brand_filter_lower = [b.lower() for b in brand_filter]
        all_items = [
            item for item in all_items
            if any(
                bf in (item.get("brand") or "").lower() or
                bf in (item.get("manufacturer") or "").lower()
                for bf in brand_filter_lower
            )
        ]
        print(f"REORDER: Filtered to {len(all_items)} items for brands: {brand_filter}")
    
    # 3. Get open PO quantities
    po_quantities = await get_open_po_quantities()
    
    if quick_mode:
        # QUICK MODE: Skip velocity calculation, use simple stock threshold
        print("REORDER: Quick mode - using stock threshold instead of velocity")
        velocity_data_last_year = {}
        velocity_data_90_day = {}
        first_sale_dates = {}
        
        # In quick mode, analyze with simple threshold
        analyses = []
        for item in all_items:
            analysis = await analyze_sku_quick(item, po_quantities)
            if analysis:
                analyses.append(analysis)
    else:
        # FULL MODE: Calculate velocity from sales history
        # 4. Get velocity data - same window last year
        last_year_start, last_year_end = get_velocity_window_dates()
        print(f"REORDER: Getting velocity data for {last_year_start} to {last_year_end}")
        velocity_data_last_year = await get_sales_velocity_data(last_year_start, last_year_end)
        
        # 5. Get 90-day velocity data (fallback for new products)
        ninety_day_start, ninety_day_end = get_90_day_window_dates()
        velocity_data_90_day = await get_sales_velocity_data(ninety_day_start, ninety_day_end)
        
        # 6. Get first sale dates (for new product detection)
        first_sale_dates = {}  # {sku: first_sale_date}
        
        # 7. Analyze each SKU
        analyses = []
        for item in all_items:
            analysis = await analyze_sku(
                item,
                po_quantities,
                velocity_data_last_year,
                velocity_data_90_day,
                first_sale_dates
            )
            if analysis:
                analyses.append(analysis)
    
    print(f"REORDER: Analyzed {len(analyses)} SKUs")
    
    # 8. Group by supplier
    supplier_orders = group_by_supplier(analyses)
    
    # 9. Summary
    total_reorder = sum(
        group.reorder_total_eur
        for group in supplier_orders.values()
    )
    reorder_skus = sum(
        len(group.reorder_items)
        for group in supplier_orders.values()
    )
    
    print(f"REORDER: Analysis complete - {reorder_skus} SKUs need reorder, total €{total_reorder:.2f}")
    
    return supplier_orders


def format_analysis_report(supplier_orders: Dict[str, SupplierOrder]) -> dict:
    """
    Format analysis results for API response.
    """
    suppliers = []
    
    for supplier_name, order in sorted(supplier_orders.items()):
        if not order.reorder_items and not order.topup_candidates:
            continue
        
        suppliers.append({
            "supplier": supplier_name,
            "minimum_eur": order.minimum_order_eur,
            "reorder_total_eur": round(order.reorder_total_eur, 2),
            "gap_to_minimum": round(order.gap_to_minimum, 2),
            "meets_minimum": order.meets_minimum,
            "reorder_items": [
                {
                    "sku": item.sku,
                    "item_id": item.item_id,
                    "name": item.name,
                    "current_stock": item.current_stock,
                    "committed_stock": item.committed_stock,
                    "available_stock": item.available_stock,
                    "open_po_qty": item.open_po_qty,
                    "effective_stock": item.effective_stock,
                    "weekly_velocity": item.weekly_velocity,
                    "weeks_of_cover": item.weeks_of_cover,
                    "status": item.status.value,
                    "cost_price": item.cost_price,
                    "suggested_qty": item.suggested_qty,
                    "order_value": item.order_value,
                }
                for item in order.reorder_items
            ],
            "topup_candidates": [
                {
                    "sku": item.sku,
                    "item_id": item.item_id,
                    "name": item.name,
                    "weeks_of_cover": item.weeks_of_cover,
                    "cost_price": item.cost_price,
                    "suggested_qty": item.suggested_qty,
                    "order_value": item.order_value,
                }
                for item in order.topup_candidates[:20]  # Limit top-ups shown
            ],
            "summary": {
                "reorder_count": len(order.reorder_items),
                "topup_count": len(order.topup_candidates),
                "anomaly_count": len([i for i in order.reorder_items if i.status == SKUStatus.ANOMALY]),
                "new_product_count": len([i for i in order.reorder_items if i.status == SKUStatus.NEW_PRODUCT]),
            }
        })
    
    # Overall summary
    total_reorder_value = sum(s["reorder_total_eur"] for s in suppliers)
    total_reorder_skus = sum(s["summary"]["reorder_count"] for s in suppliers)
    suppliers_below_minimum = len([s for s in suppliers if not s["meets_minimum"] and s["summary"]["reorder_count"] > 0])
    
    return {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_reorder_value_eur": round(total_reorder_value, 2),
            "total_reorder_skus": total_reorder_skus,
            "supplier_count": len(suppliers),
            "suppliers_below_minimum": suppliers_below_minimum,
        },
        "suppliers": suppliers
    }
