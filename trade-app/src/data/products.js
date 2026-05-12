// Mock product data shaped like Zoho Inventory's item response.
// Fields match what the existing backend's /api/products returns so this
// can later be swapped for a real fetch call without changing the UI.
// Shape: { item_id, sku, name, brand, rate, stock_on_hand, pack_qty, image_url }

const mk = (item_id, sku, name, brand, rate, stock_on_hand, pack_qty) => ({
  item_id,
  sku,
  name,
  brand,
  rate,
  stock_on_hand,
  pack_qty,
  image_url: null,
})

export const PRODUCTS = [
  // Remember
  mk('rmb-001', 'RMB-CUSH-001', 'Linen Cushion Cover - Stripes', 'remember', 18.5, 142, 1),
  mk('rmb-002', 'RMB-CUSH-002', 'Velvet Cushion - Forest Green', 'remember', 22.0, 0, 1),
  mk('rmb-003', 'RMB-TRAY-001', 'Wooden Serving Tray - Floral', 'remember', 32.75, 28, 1),
  mk('rmb-004', 'RMB-MUG-001', 'Porcelain Mug Set (x4)', 'remember', 24.0, 56, 4),
  mk('rmb-005', 'RMB-NAP-001', 'Cotton Napkins - Geometric (x6)', 'remember', 16.5, 88, 6),
  mk('rmb-006', 'RMB-VASE-001', 'Glass Vase - Amber', 'remember', 29.0, 12, 1),

  // Räder
  mk('rad-001', 'RAD-LIGHT-001', 'Poetry Light - Family', 'rader', 14.25, 220, 1),
  mk('rad-002', 'RAD-LIGHT-002', 'Poetry Light - Friendship', 'rader', 14.25, 180, 1),
  mk('rad-003', 'RAD-PLATE-001', 'Porcelain Plate "Home"', 'rader', 9.5, 340, 1),
  mk('rad-004', 'RAD-CARD-001', 'Wish Tag - Mini Stars (x12)', 'rader', 12.0, 0, 12),
  mk('rad-005', 'RAD-VASE-001', 'Stoneware Vase - Tall', 'rader', 38.0, 17, 1),
  mk('rad-006', 'RAD-ORN-001', 'Hanging Ornament - Heart', 'rader', 6.25, 410, 1),

  // Relaxound
  mk('rlx-001', 'RLX-ZWB-001', 'Zwitscherbox - Lemon Yellow', 'relaxound', 49.0, 64, 1),
  mk('rlx-002', 'RLX-ZWB-002', 'Zwitscherbox - Forest Green', 'relaxound', 49.0, 42, 1),
  mk('rlx-003', 'RLX-OCN-001', 'Oceanbox - Sea Sounds', 'relaxound', 49.0, 31, 1),
  mk('rlx-004', 'RLX-LDG-001', 'Lodgebox - Crackling Fire', 'relaxound', 52.0, 0, 1),

  // My Flame
  mk('myf-001', 'MYF-CDL-001', 'Candle - Warm Cashmere', 'myflame', 21.0, 96, 1),
  mk('myf-002', 'MYF-CDL-002', 'Candle - Fresh Cotton', 'myflame', 21.0, 110, 1),
  mk('myf-003', 'MYF-CDL-003', 'Candle - Amber & Oak', 'myflame', 21.0, 8, 1),
  mk('myf-004', 'MYF-CDL-004', 'Candle - White Lily', 'myflame', 21.0, 73, 1),
  mk('myf-005', 'MYF-DIFF-001', 'Reed Diffuser - Vanilla', 'myflame', 26.5, 45, 1),

  // Paper Products Design
  mk('ppd-001', 'PPD-NAP-001', 'Lunch Napkins - Botanical (x20)', 'ppd', 4.5, 520, 20),
  mk('ppd-002', 'PPD-NAP-002', 'Lunch Napkins - Christmas (x20)', 'ppd', 4.5, 0, 20),
  mk('ppd-003', 'PPD-WRP-001', 'Gift Wrap Roll - Gold Foil', 'ppd', 7.25, 230, 1),
  mk('ppd-004', 'PPD-NAP-003', 'Cocktail Napkins - Floral (x25)', 'ppd', 3.75, 180, 25),
  mk('ppd-005', 'PPD-PLT-001', 'Paper Plates - Geometric (x12)', 'ppd', 8.0, 95, 12),

  // Ideas4Seasons
  mk('i4s-001', 'I4S-XMS-001', 'Ceramic Christmas Tree - White', 'i4s', 19.5, 68, 1),
  mk('i4s-002', 'I4S-XMS-002', 'LED String Lights - Warm White', 'i4s', 12.0, 145, 1),
  mk('i4s-003', 'I4S-EST-001', 'Easter Egg Decorations (x6)', 'i4s', 9.75, 0, 6),
  mk('i4s-004', 'I4S-AUT-001', 'Autumn Pumpkin Decor', 'i4s', 11.5, 38, 1),
  mk('i4s-005', 'I4S-XMS-003', 'Wooden Advent Calendar', 'i4s', 42.0, 22, 1),

  // Elvang
  mk('elv-001', 'ELV-THR-001', 'Classic Throw - Charcoal', 'elvang', 89.0, 14, 1),
  mk('elv-002', 'ELV-THR-002', 'Herringbone Throw - Sand', 'elvang', 92.5, 9, 1),
  mk('elv-003', 'ELV-CSH-001', 'Cushion Cover - Wool', 'elvang', 48.0, 26, 1),
  mk('elv-004', 'ELV-THR-003', 'Baby Blanket - Soft Pink', 'elvang', 56.0, 0, 1),
]

export const getProductsByBrand = (brandId) =>
  PRODUCTS.filter((p) => p.brand === brandId)

export const getBrandStats = (brandId) => {
  const items = getProductsByBrand(brandId)
  return {
    total: items.length,
    inStock: items.filter((p) => p.stock_on_hand > 0).length,
  }
}
