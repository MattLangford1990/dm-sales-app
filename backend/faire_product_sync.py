# faire_product_sync.py
# Handles pushing products from Zoho/CDN to Faire marketplace
# Includes AI description generation via Anthropic API

import asyncio
import httpx
import json
import os
from datetime import datetime
from typing import Optional, Dict, List, Tuple
from anthropic import Anthropic

import zoho_api
import faire_api
from faire_api import (
    FaireClient, get_faire_client, save_product_mapping,
    get_faire_product_id_by_sku, make_geo_price, FaireAPIError
)
from database import SessionLocal, FaireProductMapping, FaireBrandConfig
from agents import BRAND_VARIATIONS

# ============ Config ============

anthropic_client = Anthropic()  # Uses ANTHROPIC_API_KEY env var

# Faire wholesale → retail multiplier per brand
# Adjust to match your agreed RRPs
RETAIL_MULTIPLIER = {
    "My Flame": 2.2,
    "Räder": 2.5,
    "Remember": 2.5,
    "Paper Products Design": 2.5,
    "Elvang": 2.2,
    "Relaxound": 2.0,
    "Ideas4Seasons": 2.5,
}

# Minimum order quantities per brand (pack sizes)
MIN_ORDER_QTY = {
    "My Flame": 1,
    "Räder": 1,
    "Remember": 1,
    "Paper Products Design": 1,
}

CDN_BASE = "https://cdn.appdmbrands.com"

# Brands we support on Faire (extend as you add storefronts)
FAIRE_ENABLED_BRANDS = ["My Flame"]


# ============ Brand Name Prefixing ============

def make_faire_title(item_name: str, brand_name: str) -> str:
    """Prefix product title with brand name for Faire brand collections.
    e.g. "Vanilla Candle" → "My Flame – Vanilla Candle"
    Skips prefix if name already starts with the brand name.
    """
    if item_name.lower().startswith(brand_name.lower()):
        return item_name
    return f"{brand_name} – {item_name}"


# ============ Brand Matching ============

def item_matches_brand(item: Dict, brand_name: str) -> bool:
    """Check if a Zoho item belongs to the given brand"""
    item_brand = (item.get("brand") or item.get("cf_brand") or "").strip()
    variations = BRAND_VARIATIONS.get(brand_name, [brand_name])
    return any(v.lower() in item_brand.lower() for v in variations)


def get_active_items_for_brand(all_items: List[Dict], brand_name: str) -> List[Dict]:
    """Filter Zoho items to active items for a specific brand"""
    results = []
    for item in all_items:
        if not item.get("status") == "active":
            continue
        if not item_matches_brand(item, brand_name):
            continue
        # Must have a SKU
        if not item.get("sku"):
            continue
        results.append(item)
    return results


# ============ Image Handling ============

def get_cdn_image_url(item: Dict) -> Optional[str]:
    """Get the best available image URL for a Zoho item from CDN"""
    # Check CDN custom field first (already migrated from Cloudinary)
    cdn_url = item.get("cf_cdn_image_url") or item.get("cf_image_url")
    if cdn_url and cdn_url.startswith("http"):
        return cdn_url

    # Fallback to standard Zoho image_url if it's a CDN URL
    image_url = item.get("image_url", "")
    if image_url and "cdn.appdmbrands.com" in image_url:
        return image_url

    return None


async def upload_image_to_faire(client: FaireClient, image_url: str) -> Optional[str]:
    """Upload an image from CDN to Faire, returns image token.
    Returns None if upload fails (product can still be created as DRAFT).
    """
    try:
        result = await client.upload_image_from_url(image_url)
        token = result.get("image_token") or result.get("id")
        if token:
            print(f"FAIRE SYNC: Uploaded image → token {token[:20]}...")
            return token
        return None
    except Exception as e:
        print(f"FAIRE SYNC: Image upload failed for {image_url}: {e}")
        return None


# ============ Description Generation ============

def generate_product_description(item: Dict, brand_name: str) -> Tuple[str, str]:
    """Generate a product description using Claude.
    Returns (short_description, full_description).
    Falls back gracefully if API fails.
    """
    name = item.get("name", "")
    existing_desc = item.get("description") or item.get("cf_description") or ""
    sku = item.get("sku", "")

    # If there's already a good description, use it
    if existing_desc and len(existing_desc) > 80:
        short = existing_desc[:150].rsplit(" ", 1)[0] + "..."
        return short, existing_desc

    # Generate with Claude
    prompt = f"""You are writing product copy for a wholesale marketplace (Faire) for {brand_name}, a European homeware and giftware brand distributed in the UK by DM Brands.

Product name: {name}
SKU: {sku}
Existing notes: {existing_desc or "None"}

Write:
1. SHORT DESCRIPTION (max 150 chars): A punchy one-liner for wholesale buyers. Focus on the key selling point.
2. FULL DESCRIPTION (100-200 words): Engaging trade-buyer copy. Mention material/size if inferable from the name, the brand aesthetic, and gifting appeal. Do NOT invent specific dimensions you don't know.

Respond in this exact format:
SHORT: <short description here>
FULL: <full description here>"""

    try:
        response = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()

        short = ""
        full = ""
        for line in text.split("\n"):
            if line.startswith("SHORT:"):
                short = line[6:].strip()
            elif line.startswith("FULL:"):
                full = line[5:].strip()

        # Collect multi-line full description
        if "FULL:" in text:
            full = text.split("FULL:", 1)[1].strip()

        return short[:150], full[:2000]

    except Exception as e:
        print(f"FAIRE SYNC: Description generation failed for {name}: {e}")
        fallback_short = f"{name} by {brand_name}"
        fallback_full = f"{name} – part of the {brand_name} collection. A beautifully designed piece perfect for gifting and home décor."
        return fallback_short, fallback_full


# ============ Product Builder ============

def build_faire_product(
    item: Dict,
    brand_name: str,
    short_description: str,
    full_description: str,
    image_token: Optional[str] = None,
    publish: bool = False
) -> Dict:
    """Build a Faire v2 product payload from a Zoho item.

    Title: prefixed with brand name (e.g. "My Flame – Vanilla Candle")
    so Faire can group products into brand collections.

    Pricing:
    - Uses item.rate as wholesale price (your cost to retailer)
    - Retail is wholesale × RETAIL_MULTIPLIER[brand]
    - All prices in GBP

    Lifecycle:
    - publish=False → DRAFT (safe default, no validation required)
    - publish=True  → PUBLISHED (requires image + all required fields)
    """
    sku = item.get("sku", "")
    # Prefix with brand name for Faire brand collections
    title = make_faire_title(item.get("name", ""), brand_name)
    wholesale_gbp = float(item.get("rate") or item.get("purchase_rate") or 0)
    multiplier = RETAIL_MULTIPLIER.get(brand_name, 2.5)
    retail_gbp = round(wholesale_gbp * multiplier, 2)

    lifecycle = "PUBLISHED" if publish else "DRAFT"

    # Build variant
    variant = {
        "sku": sku,
        "lifecycle_state": lifecycle,
        "available_quantity": max(0, int(item.get("stock_on_hand") or 0)),
        "prices": [
            make_geo_price(wholesale_gbp, retail_gbp, "GBR"),
            make_geo_price(wholesale_gbp, retail_gbp, "IRL"),
        ]
    }

    # Attach image to variant if we have a token
    if image_token:
        variant["images"] = [{
            "image_token": image_token,
            "sequence": 0,
            "tags": ["Hero"]
        }]

    # Build product
    product = {
        "name": title,
        "short_description": short_description,
        "description": full_description,
        "lifecycle_state": lifecycle,
        "variants": [variant]
    }

    # Minimum order quantity
    moq = MIN_ORDER_QTY.get(brand_name, 1)
    if moq > 1:
        product["minimum_order_quantity"] = moq

    return product


# ============ Single Product Push ============

async def push_product_to_faire(
    client: FaireClient,
    item: Dict,
    brand_name: str,
    publish: bool = False,
    generate_description: bool = True
) -> Dict:
    """Push a single Zoho item to Faire. Returns result dict with status."""
    sku = item.get("sku", "")
    raw_name = item.get("name", "")
    faire_title = make_faire_title(raw_name, brand_name)
    item_id = item.get("item_id", "")

    result = {
        "sku": sku,
        "name": faire_title,
        "status": "pending",
        "faire_product_id": None,
        "faire_variant_id": None,
        "error": None,
        "had_image": False,
        "description_generated": False
    }

    try:
        # Check if already synced
        existing_id = get_faire_product_id_by_sku(brand_name, sku)
        if existing_id:
            result["status"] = "already_synced"
            result["faire_product_id"] = existing_id
            return result

        # 1. Generate description
        if generate_description:
            short_desc, full_desc = generate_product_description(item, brand_name)
            result["description_generated"] = True
        else:
            short_desc = faire_title
            full_desc = item.get("description") or f"{faire_title} – part of the {brand_name} collection."

        # 2. Upload image
        image_token = None
        image_url = get_cdn_image_url(item)
        if image_url:
            image_token = await upload_image_to_faire(client, image_url)
            result["had_image"] = image_token is not None

        # 3. Build product payload
        product_data = build_faire_product(
            item, brand_name, short_desc, full_desc,
            image_token=image_token, publish=publish
        )

        # 4. Create on Faire
        response = await client.create_product(product_data)
        faire_product = response.get("product", response)

        faire_product_id = faire_product.get("id")
        variants = faire_product.get("variants", [])
        faire_variant_id = variants[0].get("id") if variants else None

        # 5. Save mapping
        save_product_mapping(
            brand_name=brand_name,
            zoho_sku=sku,
            zoho_item_id=item_id,
            faire_product_id=faire_product_id or "",
            faire_variant_id=faire_variant_id or ""
        )

        result["status"] = "created"
        result["faire_product_id"] = faire_product_id
        result["faire_variant_id"] = faire_variant_id
        print(f"FAIRE SYNC: Created '{faire_title}' ({sku}) → Faire {faire_product_id}")

    except FaireAPIError as e:
        result["status"] = "error"
        result["error"] = str(e)
        save_product_mapping(brand_name, sku, item_id, "", "", error=str(e))
        print(f"FAIRE SYNC: API error for {sku}: {e}")

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        print(f"FAIRE SYNC: Unexpected error for {sku}: {e}")

    return result


# ============ Bulk Product Push ============

async def bulk_push_products_to_faire(
    brand_name: str,
    limit: Optional[int] = None,
    publish: bool = False,
    skip_existing: bool = True,
    delay_seconds: float = 0.5
) -> Dict:
    """Push all active products for a brand to Faire.

    Args:
        brand_name: e.g. "My Flame"
        limit: max products to push (None = all)
        publish: True to publish immediately (requires images), False for DRAFT
        skip_existing: Skip SKUs that already have a Faire mapping
        delay_seconds: Delay between API calls to respect rate limits

    Returns summary dict with created/skipped/error counts.
    """
    client = get_faire_client(brand_name)
    if not client:
        return {"error": f"No active Faire config for {brand_name}"}

    print(f"FAIRE SYNC: Starting bulk push for {brand_name} (publish={publish})")

    all_items = await zoho_api.get_all_items_cached()
    brand_items = get_active_items_for_brand(all_items, brand_name)

    if limit:
        brand_items = brand_items[:limit]

    print(f"FAIRE SYNC: Found {len(brand_items)} active items for {brand_name}")

    summary = {
        "brand": brand_name,
        "total_items": len(brand_items),
        "created": 0,
        "already_synced": 0,
        "errors": 0,
        "no_image": 0,
        "results": []
    }

    for i, item in enumerate(brand_items):
        sku = item.get("sku", "")

        if skip_existing:
            existing = get_faire_product_id_by_sku(brand_name, sku)
            if existing:
                summary["already_synced"] += 1
                continue

        faire_title = make_faire_title(item.get("name", ""), brand_name)
        print(f"FAIRE SYNC: [{i+1}/{len(brand_items)}] Pushing {sku} – {faire_title}")

        result = await push_product_to_faire(
            client=client,
            item=item,
            brand_name=brand_name,
            publish=publish
        )

        summary["results"].append(result)

        if result["status"] == "created":
            summary["created"] += 1
            if not result["had_image"]:
                summary["no_image"] += 1
        elif result["status"] == "already_synced":
            summary["already_synced"] += 1
        elif result["status"] == "error":
            summary["errors"] += 1

        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

    print(f"FAIRE SYNC: Done. Created={summary['created']}, Errors={summary['errors']}, Skipped={summary['already_synced']}")
    return summary


# ============ Update Existing Product ============

async def update_product_on_faire(
    brand_name: str,
    zoho_sku: str,
    fields_to_update: Optional[List[str]] = None
) -> Dict:
    """Update an existing Faire product from Zoho data.
    fields_to_update: list of 'description', 'price', 'inventory', 'image', 'name'
    If None, updates all.
    """
    client = get_faire_client(brand_name)
    if not client:
        return {"error": f"No active Faire config for {brand_name}"}

    db = SessionLocal()
    try:
        mapping = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.zoho_sku == zoho_sku
        ).first()
        if not mapping or not mapping.faire_product_id:
            return {"error": f"No Faire mapping found for {zoho_sku}"}
        faire_product_id = mapping.faire_product_id
        faire_variant_id = mapping.faire_product_option_id
    finally:
        db.close()

    all_items = await zoho_api.get_all_items_cached()
    item = next((i for i in all_items if i.get("sku") == zoho_sku), None)
    if not item:
        return {"error": f"SKU {zoho_sku} not found in Zoho cache"}

    update_all = fields_to_update is None
    result = {"sku": zoho_sku, "faire_product_id": faire_product_id, "updated": []}

    try:
        # Update name (re-apply brand prefix)
        if update_all or "name" in fields_to_update:
            await client.update_product(faire_product_id, {
                "name": make_faire_title(item.get("name", ""), brand_name)
            })
            result["updated"].append("name")

        # Update description
        if update_all or "description" in fields_to_update:
            short_desc, full_desc = generate_product_description(item, brand_name)
            await client.update_product(faire_product_id, {
                "short_description": short_desc,
                "description": full_desc
            })
            result["updated"].append("description")

        # Update price via variant
        if faire_variant_id and (update_all or "price" in fields_to_update):
            wholesale_gbp = float(item.get("rate") or 0)
            multiplier = RETAIL_MULTIPLIER.get(brand_name, 2.5)
            retail_gbp = round(wholesale_gbp * multiplier, 2)
            await client.update_variant(faire_product_id, faire_variant_id, {
                "prices": [
                    make_geo_price(wholesale_gbp, retail_gbp, "GBR"),
                    make_geo_price(wholesale_gbp, retail_gbp, "IRL"),
                ]
            })
            result["updated"].append("price")

        # Update inventory
        if faire_variant_id and (update_all or "inventory" in fields_to_update):
            stock = max(0, int(item.get("stock_on_hand") or 0))
            await client.update_inventory_levels([{
                "sku": zoho_sku,
                "available_quantity": stock
            }])
            result["updated"].append("inventory")

        # Update image
        if update_all or "image" in fields_to_update:
            image_url = get_cdn_image_url(item)
            if image_url and faire_variant_id:
                token = await upload_image_to_faire(client, image_url)
                if token:
                    await client.update_variant(faire_product_id, faire_variant_id, {
                        "images": [{"image_token": token, "sequence": 0, "tags": ["Hero"]}]
                    })
                    result["updated"].append("image")

        result["status"] = "updated"

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)

    return result


# ============ Publish Draft Products ============

async def publish_drafted_products(brand_name: str, limit: int = 50) -> Dict:
    """Find DRAFT products in DB that have images and publish them on Faire."""
    client = get_faire_client(brand_name)
    if not client:
        return {"error": f"No active Faire config for {brand_name}"}

    db = SessionLocal()
    try:
        mappings = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name,
            FaireProductMapping.is_synced == True,
            FaireProductMapping.faire_product_id.isnot(None)
        ).limit(limit).all()
    finally:
        db.close()

    published = 0
    errors = 0

    for mapping in mappings:
        try:
            product = await client.get_product(mapping.faire_product_id)
            p = product.get("product", product)
            if p.get("lifecycle_state") == "DRAFT":
                await client.update_product(mapping.faire_product_id, {"lifecycle_state": "PUBLISHED"})
                published += 1
                await asyncio.sleep(0.3)
        except Exception as e:
            print(f"FAIRE SYNC: Error publishing {mapping.zoho_sku}: {e}")
            errors += 1

    return {"brand": brand_name, "published": published, "errors": errors}


# ============ Sync Status Report ============

async def get_sync_status(brand_name: str) -> Dict:
    """Get a summary of sync status for a brand"""
    all_items = await zoho_api.get_all_items_cached()
    brand_items = get_active_items_for_brand(all_items, brand_name)

    db = SessionLocal()
    try:
        mappings = db.query(FaireProductMapping).filter(
            FaireProductMapping.brand_name == brand_name
        ).all()
        synced_skus = {m.zoho_sku for m in mappings if m.is_synced}
        error_skus = {m.zoho_sku: m.sync_error for m in mappings if m.sync_error}
    finally:
        db.close()

    total = len(brand_items)
    synced = len(synced_skus)
    with_image = sum(1 for i in brand_items if get_cdn_image_url(i))

    return {
        "brand": brand_name,
        "total_active_items": total,
        "synced_to_faire": synced,
        "not_yet_synced": total - synced,
        "have_cdn_image": with_image,
        "no_image": total - with_image,
        "sync_errors": len(error_skus),
        "error_details": error_skus
    }
