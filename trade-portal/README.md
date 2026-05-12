# DM Brands Trade Portal

Standalone B2B trade portal: trade signup/login, brand-organised catalogue,
cart, checkout, and order history. Separate from `frontend/`, `backend/`,
and `trade-app/` — its own stack, its own database.

## Stack

- **Frontend**: React 18 + Vite + Tailwind + React Router
- **Backend**: FastAPI + SQLAlchemy + SQLite + JWT auth
- **Data**: Mock products shaped like Zoho Inventory responses

## Run locally

### Backend (port 8001)

```bash
cd trade-portal/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### Frontend (port 5175)

```bash
cd trade-portal/frontend
npm install
npm run dev
```

Vite proxies `/api/*` to `http://localhost:8001`.

## Flow

1. `/signup` — trade customer fills business details, account auto-created.
2. `/login` — email + password, returns JWT.
3. `/` — catalogue: grid of brand cards.
4. `/brand/:id` — products for a brand with trade price + stock.
5. `/product/:sku` — detail page with qty picker.
6. `/cart` → `/checkout` — places order against the user's account.
7. `/account` — order history, account details.

## Swap mock data for real Zoho

`backend/products_data.py` is the only place products live. Replace
`PRODUCTS` / `BRANDS` / `get_product_by_sku` with calls to the existing
`backend/zoho_api.py` client to pull live data. The API contract stays
the same so the frontend won't need changes.

## Auth notes

- Tokens stored in `localStorage` as `tp_token` (simple; swap for
  HTTP-only cookies for production).
- Signup currently auto-approves accounts (`status="approved"`). Flip
  the default in `main.py` to `"pending"` and add an admin approval
  endpoint when ready.
- `SECRET_KEY` env var should be set in production (defaults to a
  dev placeholder).
