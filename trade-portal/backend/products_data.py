"""Mock product catalogue. Shape mirrors Zoho Inventory item responses so this
can be swapped for a real Zoho client without changing the API or the
frontend."""

BRANDS = [
    {"id": "remember", "name": "Remember", "tagline": "Colourful design from Denmark", "origin": "Denmark", "accent": "from-rose-400 to-pink-500"},
    {"id": "rader", "name": "Räder", "tagline": "Poetic homeware from Germany", "origin": "Germany", "accent": "from-stone-400 to-stone-600"},
    {"id": "relaxound", "name": "Relaxound", "tagline": "Nature sounds for the home", "origin": "Germany", "accent": "from-emerald-400 to-teal-600"},
    {"id": "myflame", "name": "My Flame", "tagline": "Scented soy candles", "origin": "Netherlands", "accent": "from-amber-400 to-orange-500"},
    {"id": "ppd", "name": "Paper Products Design", "tagline": "Napkins, paper & gift wrap", "origin": "Germany", "accent": "from-sky-400 to-blue-600"},
    {"id": "i4s", "name": "Ideas4Seasons", "tagline": "Seasonal home decor", "origin": "Netherlands", "accent": "from-violet-400 to-purple-600"},
    {"id": "elvang", "name": "Elvang", "tagline": "Premium throws & blankets", "origin": "Denmark", "accent": "from-slate-400 to-slate-700"},
]


def _p(sku, name, brand, rate, stock, pack=1, desc=None):
    return {
        "item_id": sku.lower(),
        "sku": sku,
        "name": name,
        "brand": brand,
        "rate": rate,
        "stock_on_hand": stock,
        "pack_qty": pack,
        "description": desc or f"{name} - trade product from {brand}.",
        "image_url": None,
    }


PRODUCTS = [
    # Remember
    _p("RMB-CUSH-001", "Linen Cushion Cover - Stripes", "remember", 18.5, 142),
    _p("RMB-CUSH-002", "Velvet Cushion - Forest Green", "remember", 22.0, 0),
    _p("RMB-TRAY-001", "Wooden Serving Tray - Floral", "remember", 32.75, 28),
    _p("RMB-MUG-001", "Porcelain Mug Set", "remember", 24.0, 56, 4),
    _p("RMB-NAP-001", "Cotton Napkins - Geometric", "remember", 16.5, 88, 6),
    _p("RMB-VASE-001", "Glass Vase - Amber", "remember", 29.0, 12),
    # Räder
    _p("RAD-LIGHT-001", "Poetry Light - Family", "rader", 14.25, 220),
    _p("RAD-LIGHT-002", "Poetry Light - Friendship", "rader", 14.25, 180),
    _p("RAD-PLATE-001", 'Porcelain Plate "Home"', "rader", 9.5, 340),
    _p("RAD-CARD-001", "Wish Tag - Mini Stars", "rader", 12.0, 0, 12),
    _p("RAD-VASE-001", "Stoneware Vase - Tall", "rader", 38.0, 17),
    _p("RAD-ORN-001", "Hanging Ornament - Heart", "rader", 6.25, 410),
    # Relaxound
    _p("RLX-ZWB-001", "Zwitscherbox - Lemon Yellow", "relaxound", 49.0, 64),
    _p("RLX-ZWB-002", "Zwitscherbox - Forest Green", "relaxound", 49.0, 42),
    _p("RLX-OCN-001", "Oceanbox - Sea Sounds", "relaxound", 49.0, 31),
    _p("RLX-LDG-001", "Lodgebox - Crackling Fire", "relaxound", 52.0, 0),
    # My Flame
    _p("MYF-CDL-001", "Candle - Warm Cashmere", "myflame", 21.0, 96),
    _p("MYF-CDL-002", "Candle - Fresh Cotton", "myflame", 21.0, 110),
    _p("MYF-CDL-003", "Candle - Amber & Oak", "myflame", 21.0, 8),
    _p("MYF-CDL-004", "Candle - White Lily", "myflame", 21.0, 73),
    _p("MYF-DIFF-001", "Reed Diffuser - Vanilla", "myflame", 26.5, 45),
    # PPD
    _p("PPD-NAP-001", "Lunch Napkins - Botanical", "ppd", 4.5, 520, 20),
    _p("PPD-NAP-002", "Lunch Napkins - Christmas", "ppd", 4.5, 0, 20),
    _p("PPD-WRP-001", "Gift Wrap Roll - Gold Foil", "ppd", 7.25, 230),
    _p("PPD-NAP-003", "Cocktail Napkins - Floral", "ppd", 3.75, 180, 25),
    _p("PPD-PLT-001", "Paper Plates - Geometric", "ppd", 8.0, 95, 12),
    # i4s
    _p("I4S-XMS-001", "Ceramic Christmas Tree - White", "i4s", 19.5, 68),
    _p("I4S-XMS-002", "LED String Lights - Warm White", "i4s", 12.0, 145),
    _p("I4S-EST-001", "Easter Egg Decorations", "i4s", 9.75, 0, 6),
    _p("I4S-AUT-001", "Autumn Pumpkin Decor", "i4s", 11.5, 38),
    _p("I4S-XMS-003", "Wooden Advent Calendar", "i4s", 42.0, 22),
    # Elvang
    _p("ELV-THR-001", "Classic Throw - Charcoal", "elvang", 89.0, 14),
    _p("ELV-THR-002", "Herringbone Throw - Sand", "elvang", 92.5, 9),
    _p("ELV-CSH-001", "Cushion Cover - Wool", "elvang", 48.0, 26),
    _p("ELV-THR-003", "Baby Blanket - Soft Pink", "elvang", 56.0, 0),
]


def get_product_by_sku(sku: str):
    for p in PRODUCTS:
        if p["sku"] == sku:
            return p
    return None
