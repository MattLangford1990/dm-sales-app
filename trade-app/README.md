# DM Brands Trade App

Standalone trade catalogue showing all DM Brands brands as individual sections
with live Zoho-style stock and sale price.

This is separate from the main `frontend/` sales-agent app — it does not share
state, auth, or routes.

## Run

```bash
cd trade-app
npm install
npm run dev          # http://localhost:5174
npm run build        # production build → dist/
```

## What's here

- **Brand sections** — each of the 7 brands (Remember, Räder, Relaxound, My Flame,
  Paper Products Design, Ideas4Seasons, Elvang) gets its own coloured card on
  the landing page. Tap one to drill in.
- **Product list per brand** — name, SKU, trade price, pack qty, and stock-level
  badge (in stock / low / out of stock). Search by name or SKU; filter
  in-stock only.
- **Zoho-shaped data** — `src/data/products.js` mirrors the field names
  returned by `/api/products` in the main backend (`item_id`, `sku`, `name`,
  `brand`, `rate`, `stock_on_hand`, `pack_qty`). To wire to real Zoho, replace
  `getProductsByBrand` with a `fetch('/api/products?brand=...')` call.

## Files

- `src/App.jsx` — single-component app: header, brand grid, product list.
- `src/data/brands.js` — brand catalogue (id, name, tagline, accent colour).
- `src/data/products.js` — mock product data shaped like Zoho responses.
