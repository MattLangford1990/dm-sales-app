# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DM Sales App is a PWA/native mobile app for DM Brands sales agents to manage orders. It integrates with Zoho Inventory for product/customer/order data.

## Development Commands

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev          # Dev server at http://localhost:5173
npm run build        # Production build to dist/
```

### Backend (FastAPI + Python)
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Full Build (for deployment)
```bash
./build.sh           # Builds frontend, copies to backend/static, installs backend deps
```

### Native App (Capacitor)
```bash
cd frontend
npm run build:ios      # Build and sync to iOS
npm run build:android  # Build and sync to Android
npm run cap:open:ios   # Open in Xcode
npm run cap:open:android  # Open in Android Studio
```

## Architecture

### Frontend (`frontend/src/`)
- **App.jsx**: Single-file React app (~5000 lines). Contains all components, routing, and state management. Uses React Context for auth.
- **offlineStore.js**: IndexedDB wrapper for offline data (products, customers, images, pending orders, auth credentials).
- **syncService.js**: Handles downloading data for offline use from API or CDN feed.

### Backend (`backend/`)
- **main.py**: FastAPI app with all API endpoints. Serves frontend static files in production.
- **zoho_api.py**: Zoho Inventory API integration with OAuth token refresh and caching.
- **agents.py**: Agent (user) configuration. Uses PostgreSQL in production, SQLite locally.
- **database.py**: SQLAlchemy models (Agent, Catalogue, CatalogueRequest, ProductFeed).
- **reorder_service.py**: Logic for Räder automatic reorder suggestions.

### Key Data Files (`backend/`)
- `eans.json`: EAN/barcode mappings for Ideas4Seasons products
- `pack_quantities.json`: Pack quantity data for products
- `image_urls.json`: Cloudinary URLs for product images

### API Configuration
- Frontend uses `/api` prefix (proxied to backend in dev via Vite)
- Native app uses `https://appdmbrands.com/api` directly
- Product images served from CDN at `https://cdn.appdmbrands.com`

## Key Patterns

### Offline-First
The app is designed to work offline after initial sync:
1. Products/customers cached in IndexedDB
2. Orders created offline are queued in `pendingOrders` store
3. Login credentials cached for offline authentication
4. Product feed served as static JSON from `/api/feed/products`

### Brand Filtering
Agents are assigned specific brands. Products are filtered by brand patterns defined in `agents.py` `BRAND_VARIATIONS`.

### Zoho Integration
All product, customer, and order data comes from Zoho Inventory API. The backend caches items for 30 minutes to reduce API calls.

## Environment Variables

Required in `backend/.env`:
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` - Zoho API credentials
- `SECRET_KEY` - JWT signing key
- `DATABASE_URL` - PostgreSQL connection string (optional, falls back to SQLite)

## Deployment

Deployed to Render.com. See `render.yaml` for configuration.
- Build command: `chmod +x build.sh && ./build.sh`
- Start command: `cd backend && gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`
