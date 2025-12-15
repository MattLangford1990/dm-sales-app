#!/bin/bash
set -e

echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

echo "Copying frontend build to backend/static..."
# Preserve feeds directory if it exists
if [ -d "backend/static/feeds" ]; then
    echo "Preserving feeds directory..."
    mv backend/static/feeds /tmp/feeds_backup
fi

rm -rf backend/static
cp -r frontend/dist backend/static

# Restore feeds directory
if [ -d "/tmp/feeds_backup" ]; then
    echo "Restoring feeds directory..."
    mv /tmp/feeds_backup backend/static/feeds
fi

# Create feeds directory if it doesn't exist
mkdir -p backend/static/feeds

echo "Installing backend dependencies..."
cd backend
pip install -r requirements.txt

echo "Build complete!"
