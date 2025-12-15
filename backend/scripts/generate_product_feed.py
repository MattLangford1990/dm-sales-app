#!/usr/bin/env python3
"""
Generate static product feed JSON.
Run via cron every 4 hours to keep products up to date.

Usage:
  python generate_product_feed.py

Output:
  - Saves products.json to backend/static/feeds/products.json
  - Served at /static/feeds/products.json
"""

import asyncio
import json
import os
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from config import get_settings

settings = get_settings()


async def get_zoho_token():
    """Get fresh Zoho access token"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://accounts.zoho.eu/oauth/v2/token",
            params={
                "refresh_token": settings.zoho_refresh_token,
                "client_id": settings.zoho_client_id,
                "client_secret": settings.zoho_client_secret,
                "grant_type": "refresh_token"
            }
        )
        response.raise_for_status()
        data = response.json()
        return data["access_token"]


async def fetch_all_products():
    """Fetch ALL products from Zoho Inventory"""
    token = await get_zoho_token()
    all_items = []
    page = 1
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            print(f"  Fetching page {page}...")
            response = await client.get(
                "https://www.zohoapis.eu/inventory/v1/items",
                headers={"Authorization": f"Zoho-oauthtoken {token}"},
                params={
                    "organization_id": settings.zoho_org_id,
                    "page": page,
                    "per_page": 200
                }
            )
            response.raise_for_status()
            data = response.json()
            
            items = data.get("items", [])
            all_items.extend(items)
            print(f"    Got {len(items)} items (total: {len(all_items)})")
            
            if not data.get("page_context", {}).get("has_more_page", False):
                break
            page += 1
            
            if page > 100:  # Safety limit
                print("  WARNING: Hit page limit!")
                break
    
    return all_items


def transform_product(item, pack_quantities):
    """Transform Zoho item to our product format"""
    sku = item.get("sku", "")
    return {
        "item_id": item.get("item_id"),
        "name": item.get("name"),
        "sku": sku,
        "ean": item.get("ean") or item.get("upc") or "",
        "description": item.get("description", ""),
        "rate": item.get("rate", 0),
        "stock_on_hand": item.get("stock_on_hand", 0),
        "brand": item.get("brand") or item.get("manufacturer") or "",
        "unit": item.get("unit", "pcs"),
        "pack_qty": pack_quantities.get(sku),
        "status": item.get("status", "active")
    }


async def main():
    print(f"\n{'='*60}")
    print(f"PRODUCT FEED GENERATOR - {datetime.now().isoformat()}")
    print(f"{'='*60}\n")
    
    # Load pack quantities
    pack_qty_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "pack_quantities.json")
    pack_quantities = {}
    if os.path.exists(pack_qty_file):
        with open(pack_qty_file) as f:
            pack_quantities = json.load(f)
        print(f"Loaded {len(pack_quantities)} pack quantities")
    
    # Fetch all products from Zoho
    print("\n1. Fetching products from Zoho...")
    all_items = await fetch_all_products()
    print(f"   Total items fetched: {len(all_items)}")
    
    # Filter out inactive
    active_items = [i for i in all_items if i.get("status") != "inactive"]
    print(f"   Active items: {len(active_items)}")
    
    # Transform to our format
    print("\n2. Transforming products...")
    products = [transform_product(item, pack_quantities) for item in active_items]
    
    # Sort by SKU
    products.sort(key=lambda x: (x.get("sku") or "").upper())
    
    # Build feed JSON
    feed = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "total_products": len(products),
        "products": products
    }
    
    json_data = json.dumps(feed, separators=(',', ':'))  # Compact JSON
    size_kb = len(json_data) / 1024
    print(f"   Feed size: {size_kb:.1f} KB")
    
    # Save to static/feeds directory
    print("\n3. Saving feed file...")
    feeds_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "feeds")
    os.makedirs(feeds_dir, exist_ok=True)
    
    feed_file = os.path.join(feeds_dir, "products.json")
    with open(feed_file, "w") as f:
        f.write(json_data)
    print(f"   Saved: {feed_file}")
    
    print(f"\n{'='*60}")
    print("FEED GENERATION COMPLETE")
    print(f"  Products: {len(products)}")
    print(f"  Size: {size_kb:.1f} KB")
    print(f"  File: {feed_file}")
    print(f"{'='*60}\n")
    
    return feed_file


if __name__ == "__main__":
    asyncio.run(main())
