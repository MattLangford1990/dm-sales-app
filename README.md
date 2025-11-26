# DM Sales App

Sales order management PWA for DM Brands agents.

## Features
- Agent login with PIN
- Browse products filtered by brand
- Search products and customers  
- Create sales orders
- View order history
- Works offline (PWA)
- Mobile-friendly design

## Deployment to Render

### Option 1: Using render.yaml (Blueprint)

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New" → "Blueprint"
4. Connect your GitHub repo
5. Render will detect `render.yaml` and configure automatically
6. Add environment variables when prompted:
   - `ZOHO_CLIENT_ID`
   - `ZOHO_CLIENT_SECRET`
   - `ZOHO_REFRESH_TOKEN`
   - `ZOHO_ORG_ID`
   - `SECRET_KEY` (auto-generated)

### Option 2: Manual Setup

1. Push to GitHub
2. Go to Render Dashboard → "New" → "Web Service"
3. Connect your repo
4. Configure:
   - **Runtime**: Python
   - **Build Command**: `chmod +x build.sh && ./build.sh`
   - **Start Command**: `cd backend && gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`
5. Add environment variables (same as above)
6. Deploy!

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_CLIENT_ID` | Zoho API client ID |
| `ZOHO_CLIENT_SECRET` | Zoho API client secret |
| `ZOHO_REFRESH_TOKEN` | Zoho OAuth refresh token |
| `ZOHO_ORG_ID` | Zoho organization ID |
| `SECRET_KEY` | JWT signing key (auto-generated on Render) |

## Local Development

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
cp .env.example .env  # Then edit with your Zoho credentials
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Access at http://localhost:5173

## Agents

Default test agents:
- Kate Ellis: ID `kate`, PIN `1234` (Remember, Räder, My Flame, Ideas4Seasons)
- Nick Barr: ID `nick`, PIN `5678` (All 7 brands)

Edit `backend/agents.py` to configure agents and their brands.

## Tech Stack
- **Frontend**: React, Vite, TailwindCSS, PWA
- **Backend**: FastAPI, Python
- **Database**: Zoho Inventory (via API)
