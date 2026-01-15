#!/usr/bin/env python3
"""
Update Ideas4Seasons prices and EANs in Zoho Inventory
Run from: cd ~/Desktop/dm-sales-app/backend && python scripts/update_i4s_prices_eans.py
"""

import httpx
import json
import time
import os
import sys

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import get_settings

settings = get_settings()

API_BASE = "https://www.zohoapis.eu/inventory/v1"

# Load prices and EANs from JSON files
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)

PRICES_FILE = os.path.join(BACKEND_DIR, "i4s_prices_2026.json")
EANS_FILE = os.path.join(BACKEND_DIR, "eans.json")


def get_access_token():
    """Get fresh Zoho access token"""
    response = httpx.post(
        "https://accounts.zoho.eu/oauth/v2/token",
        data={
            "refresh_token": settings.zoho_refresh_token,
            "client_id": settings.zoho_client_id,
            "client_secret": settings.zoho_client_secret,
            "grant_type": "refresh_token"
        }
    )
    return response.json()["access_token"]


def get_all_items(headers):
    """Fetch all items from Zoho"""
    all_items = []
    page = 1
    while True:
        for attempt in range(3):
            try:
                with httpx.Client(timeout=30) as client:
                    response = client.get(
                        f"{API_BASE}/items",
                        headers=headers,
                        params={"page": page, "per_page": 200}
                    )
                    data = response.json()
                    items = data.get("items", [])
                    all_items.extend(items)
                    if page % 10 == 0:
                        print(f"  Fetched page {page} (total: {len(all_items)})")
                    if not data.get("page_context", {}).get("has_more_page", False):
                        return all_items
                    page += 1
                    time.sleep(0.3)
                    break
            except Exception as e:
                print(f"  Retry {attempt+1} for page {page}: {e}")
                time.sleep(2)
        else:
            print(f"Failed to fetch page {page} after 3 attempts")
            return all_items
    return all_items


def main():
    # Load prices
    if not os.path.exists(PRICES_FILE):
        print(f"ERROR: Prices file not found: {PRICES_FILE}")
        sys.exit(1)
    
    with open(PRICES_FILE, 'r') as f:
        new_prices = json.load(f)
    print(f"Loaded {len(new_prices)} prices from {PRICES_FILE}")
    
    # Load EANs
    if not os.path.exists(EANS_FILE):
        print(f"ERROR: EANs file not found: {EANS_FILE}")
        sys.exit(1)
    
    with open(EANS_FILE, 'r') as f:
        new_eans = json.load(f)
    print(f"Loaded {len(new_eans)} EANs from {EANS_FILE}")
    
    # Get access token
    print("\nGetting Zoho access token...")
    token = get_access_token()
    print("Got access token")
    
    headers = {
        "Authorization": f"Zoho-oauthtoken {token}",
        "X-com-zoho-inventory-organizationid": settings.zoho_org_id,
        "Content-Type": "application/json"
    }
    
    # Fetch all items
    print("\nFetching all items from Zoho...")
    zoho_items = get_all_items(headers)
    print(f"Total Zoho items: {len(zoho_items)}")
    
    # Find items that need updating
    updates = []
    for item in zoho_items:
        sku = item.get("sku", "")
        item_id = item.get("item_id")
        
        if sku not in new_prices:
            continue  # Not an I4S item
        
        current_price = item.get("rate", 0) or 0
        current_ean = item.get("ean") or item.get("upc") or ""
        
        new_price = new_prices.get(sku)
        new_ean = new_eans.get(sku, "")
        
        price_changed = abs(current_price - new_price) > 0.005
        ean_needs_update = new_ean and (not current_ean or current_ean != new_ean)
        
        if price_changed or ean_needs_update:
            updates.append({
                "item_id": item_id,
                "sku": sku,
                "name": item.get("name"),
                "current_price": current_price,
                "new_price": new_price,
                "price_changed": price_changed,
                "current_ean": current_ean,
                "new_ean": new_ean,
                "ean_needs_update": ean_needs_update
            })
    
    price_updates = len([u for u in updates if u['price_changed']])
    ean_updates = len([u for u in updates if u['ean_needs_update']])
    
    print(f"\n{'='*50}")
    print(f"UPDATES NEEDED")
    print(f"{'='*50}")
    print(f"Total items to update: {len(updates)}")
    print(f"  - Price changes: {price_updates}")
    print(f"  - EAN additions: {ean_updates}")
    
    if not updates:
        print("\nNo updates needed!")
        return
    
    # Show sample of changes
    print(f"\nSample changes (first 20):")
    for u in updates[:20]:
        changes = []
        if u['price_changed']:
            changes.append(f"£{u['current_price']:.2f} -> £{u['new_price']:.2f}")
        if u['ean_needs_update']:
            changes.append(f"EAN: {u['new_ean']}")
        print(f"  {u['sku']}: {', '.join(changes)}")
    
    # Confirm before proceeding
    print(f"\n{'='*50}")
    response = input(f"Proceed with updating {len(updates)} items in Zoho? (yes/no): ")
    if response.lower() != 'yes':
        print("Aborted.")
        return
    
    # Do the updates
    print(f"\n{'='*50}")
    print("UPDATING ZOHO")
    print(f"{'='*50}")
    
    success = 0
    failed = 0
    errors = []
    
    for i, item in enumerate(updates):
        # Build update payload
        update_data = {"rate": item["new_price"]}
        if item["ean_needs_update"]:
            update_data["ean"] = item["new_ean"]
        
        for attempt in range(3):
            try:
                with httpx.Client(timeout=30) as client:
                    response = client.put(
                        f"{API_BASE}/items/{item['item_id']}",
                        headers=headers,
                        content=json.dumps(update_data)
                    )
                    
                    if response.status_code == 200:
                        success += 1
                        if (i + 1) % 50 == 0:
                            print(f"  Progress: {i+1}/{len(updates)} ({success} success, {failed} failed)")
                        break
                    else:
                        error_msg = f"{item['sku']}: {response.status_code} - {response.text[:100]}"
                        errors.append(error_msg)
                        failed += 1
                        break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2)
                else:
                    errors.append(f"{item['sku']}: {e}")
                    failed += 1
        
        time.sleep(0.3)  # Rate limiting
    
    print(f"\n{'='*50}")
    print("COMPLETE")
    print(f"{'='*50}")
    print(f"Successfully updated: {success}")
    print(f"Failed: {failed}")
    
    if errors:
        print(f"\nErrors:")
        for e in errors[:20]:
            print(f"  {e}")
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")


if __name__ == "__main__":
    main()
