#!/usr/bin/env python3
"""
Stock Adjustment Script for Zoho Inventory
Creates an inventory adjustment to add stock for specified SKUs.

Usage:
    cd ~/Desktop/dm-sales-app/backend
    source venv/bin/activate
    python scripts/stock_adjustment.py
"""

import asyncio
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from zoho_api import zoho_request, get_all_items_cached


# ============ CONFIGURATION ============
# SKUs to adjust (1 of each)
SKUS_TO_ADJUST = [
    "PG01",
    "LT01",
    "CA1",
    "SKU01",
    "BP02",
    "BP07",
    "BV03",
    "SE2",
    "KY01",
    "SO01",
]

QUANTITY_EACH = 1
REASON = "Stock received"  # Adjustment reason
DESCRIPTION = "Stock book in - 1 of each"  # Optional description
# ========================================


async def find_item_ids_by_sku(skus: list[str]) -> dict[str, dict]:
    """
    Find Zoho item_ids for a list of SKUs.
    Returns dict mapping SKU -> {item_id, name, sku}
    """
    print("Fetching all items from Zoho (using cache if available)...")
    all_items = await get_all_items_cached()
    print(f"Loaded {len(all_items)} items")
    
    # Build lookup by SKU
    sku_to_item = {}
    for item in all_items:
        item_sku = item.get("sku", "")
        if item_sku:
            sku_to_item[item_sku.upper()] = {
                "item_id": item["item_id"],
                "name": item.get("name", ""),
                "sku": item_sku,
            }
    
    # Find matches
    results = {}
    not_found = []
    
    for sku in skus:
        sku_upper = sku.upper()
        if sku_upper in sku_to_item:
            results[sku] = sku_to_item[sku_upper]
        else:
            not_found.append(sku)
    
    if not_found:
        print(f"\n⚠️  SKUs not found in Zoho: {', '.join(not_found)}")
    
    return results


async def create_inventory_adjustment(items: dict[str, dict], quantity: int, reason: str, description: str = "") -> dict:
    """
    Create an inventory adjustment in Zoho to add stock.
    
    Args:
        items: Dict of SKU -> {item_id, name, sku}
        quantity: Quantity to add for each item
        reason: Reason for adjustment
        description: Optional description
    """
    # Build line items
    line_items = []
    for sku, item_data in items.items():
        line_items.append({
            "item_id": item_data["item_id"],
            "quantity_adjusted": quantity,  # Positive = add stock
        })
    
    # Build adjustment payload
    adjustment_data = {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "reason": reason,
        "adjustment_type": "quantity",
        "line_items": line_items,
    }
    
    if description:
        adjustment_data["description"] = description
    
    print(f"\nCreating inventory adjustment...")
    print(f"  Date: {adjustment_data['date']}")
    print(f"  Reason: {reason}")
    print(f"  Items: {len(line_items)}")
    print(f"  Quantity each: +{quantity}")
    
    # Create the adjustment
    result = await zoho_request("POST", "inventoryadjustments", json=adjustment_data)
    
    return result


async def main():
    print("=" * 60)
    print("ZOHO INVENTORY STOCK ADJUSTMENT")
    print("=" * 60)
    print(f"\nSKUs to adjust: {', '.join(SKUS_TO_ADJUST)}")
    print(f"Quantity each: +{QUANTITY_EACH}")
    print(f"Reason: {REASON}")
    
    # Find item IDs
    items = await find_item_ids_by_sku(SKUS_TO_ADJUST)
    
    if not items:
        print("\n❌ No matching items found. Exiting.")
        return
    
    print(f"\n✓ Found {len(items)} items:")
    for sku, data in items.items():
        print(f"  - {sku}: {data['name']} (ID: {data['item_id']})")
    
    # Confirm before proceeding
    missing_count = len(SKUS_TO_ADJUST) - len(items)
    if missing_count > 0:
        print(f"\n⚠️  {missing_count} SKU(s) not found - they will be skipped")
    
    confirm = input("\nProceed with adjustment? [y/N]: ").strip().lower()
    if confirm != 'y':
        print("Cancelled.")
        return
    
    # Create the adjustment
    try:
        result = await create_inventory_adjustment(
            items=items,
            quantity=QUANTITY_EACH,
            reason=REASON,
            description=DESCRIPTION,
        )
        
        if result.get("code") == 0:
            adj = result.get("inventory_adjustment", {})
            print(f"\n✅ SUCCESS!")
            print(f"   Adjustment ID: {adj.get('inventory_adjustment_id')}")
            print(f"   Reference: {adj.get('reference_number', 'N/A')}")
            print(f"   Total items adjusted: {len(adj.get('line_items', []))}")
        else:
            print(f"\n❌ Error: {result.get('message', 'Unknown error')}")
            
    except Exception as e:
        print(f"\n❌ Error creating adjustment: {e}")


if __name__ == "__main__":
    asyncio.run(main())
