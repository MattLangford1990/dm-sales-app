#!/usr/bin/env python3
"""Test the actual PDF endpoint locally"""

import json

# Test image - small red pixel
TEST_IMAGE_B64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

# Mock request payload
payload = {
    "items": [
        {
            "item_id": "test1",
            "name": "My Flame Lifestyle Scented soy candle",
            "sku": "WBR.006.01",
            "ean": "123456789",
            "rate": 5.41,
            "quantity": 168,
            "discount": 0,
            "image_data": TEST_IMAGE_B64
        },
        {
            "item_id": "test2", 
            "name": "My Flame Lifestyle Scented soy candle 2",
            "sku": "WBR.006.02",
            "ean": "123456790",
            "rate": 5.41,
            "quantity": 16,
            "discount": 0,
            "image_data": TEST_IMAGE_B64
        }
    ],
    "customer_name": "Test Customer",
    "customer_email": None,
    "include_images": True,
    "doc_type": "quote"
}

print("Payload size:", len(json.dumps(payload)), "bytes")
print()

# Note: You need to run the server first with:
# cd /Users/matt/Desktop/dm-sales-app/backend && ./venv/bin/uvicorn main:app --reload --port 8000

# For now, just print the payload structure
print("Test payload ready. To test:")
print("1. Run: cd /Users/matt/Desktop/dm-sales-app/backend && ./venv/bin/uvicorn main:app --port 8000")
print("2. Then run this script again with the server running")
print()
print("Or test manually with curl:")
print(f"curl -X POST http://localhost:8000/api/export/quote-pdf -H 'Content-Type: application/json' -H 'Authorization: Bearer YOUR_TOKEN' -d '{json.dumps(payload)}' -o test.pdf")
