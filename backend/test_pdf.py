#!/usr/bin/env python3
"""Test PDF generation locally without Zoho API calls"""

import io
import base64
from datetime import datetime

# Create a simple test image (1x1 red pixel PNG)
TEST_IMAGE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

def test_pdf_generation():
    """Test the PDF generation logic"""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image as RLImage
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
    from PIL import Image
    
    print("Starting PDF generation test...")
    
    # Simulate request data
    items = [
        {"sku": "WBR.006.01", "name": "My Flame Lifestyle Scented soy candle", "rate": 5.41, "quantity": 168, "discount": 0, "ean": "123456789", "image_data": f"data:image/png;base64,{TEST_IMAGE_B64}"},
        {"sku": "WBR.006.02", "name": "My Flame Lifestyle Scented soy candle 2", "rate": 5.41, "quantity": 16, "discount": 0, "ean": "123456790", "image_data": f"data:image/png;base64,{TEST_IMAGE_B64}"},
    ]
    customer_name = "Test Customer"
    include_images = True
    doc_type = "quote"
    agent_name = "Matt"
    
    print(f"Items: {len(items)}, include_images: {include_images}")
    
    # Create PDF buffer
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=A4, 
        topMargin=15*mm, 
        bottomMargin=15*mm,
        leftMargin=12*mm,
        rightMargin=12*mm
    )
    
    page_width = A4[0] - 24*mm
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=20, alignment=TA_CENTER, spaceAfter=2*mm)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER, textColor=colors.grey)
    normal_style = styles['Normal']
    cell_style = ParagraphStyle('Cell', parent=styles['Normal'], fontSize=9, leading=11)
    
    elements = []
    
    # Header
    doc_title = "Order Confirmation" if doc_type == "order" else "Product Quotation"
    elements.append(Paragraph("DM Brands Ltd", title_style))
    elements.append(Paragraph(doc_title, subtitle_style))
    elements.append(Spacer(1, 6*mm))
    
    # Quote info
    date_str = datetime.now().strftime("%d %B %Y")
    info_data = []
    if customer_name:
        info_data.append([Paragraph("<b>Customer:</b>", normal_style), Paragraph(customer_name, normal_style)])
    info_data.append([Paragraph("<b>Date:</b>", normal_style), Paragraph(date_str, normal_style)])
    info_data.append([Paragraph("<b>Prepared by:</b>", normal_style), Paragraph(agent_name, normal_style)])
    
    if info_data:
        info_table = Table(info_data, colWidths=[70, page_width - 70])
        info_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 6*mm))
    
    # Process images from client
    image_cache = {}
    if include_images:
        print(f"Processing {len(items)} items with client-side images")
        for item in items:
            image_data = item.get("image_data")
            if image_data:
                try:
                    if ',' in image_data:
                        base64_data = image_data.split(',')[1]
                    else:
                        base64_data = image_data
                    image_cache[item["sku"]] = base64.b64decode(base64_data)
                    print(f"  Decoded image for {item['sku']}")
                except Exception as e:
                    print(f"  Error decoding image for {item['sku']}: {e}")
        print(f"Got {len(image_cache)} images from client")
    
    # Column widths
    if include_images:
        col_widths = [25*mm, page_width - 25*mm - 18*mm - 22*mm - 25*mm, 18*mm, 22*mm, 25*mm]
    else:
        col_widths = [page_width - 18*mm - 22*mm - 25*mm, 18*mm, 22*mm, 25*mm]
    
    # Header row
    if include_images:
        header_row = [
            Paragraph("<font color='white'><b>Image</b></font>", cell_style),
            Paragraph("<font color='white'><b>Product Details</b></font>", cell_style),
            Paragraph("<font color='white'><b>Qty</b></font>", cell_style),
            Paragraph("<font color='white'><b>Price</b></font>", cell_style),
            Paragraph("<font color='white'><b>Total</b></font>", cell_style),
        ]
    else:
        header_row = [
            Paragraph("<font color='white'><b>Product Details</b></font>", cell_style),
            Paragraph("<font color='white'><b>Qty</b></font>", cell_style),
            Paragraph("<font color='white'><b>Price</b></font>", cell_style),
            Paragraph("<font color='white'><b>Total</b></font>", cell_style),
        ]
    
    table_data = [header_row]
    grand_total = 0
    
    for item in items:
        line_total = item["rate"] * item["quantity"]
        discount = item.get("discount", 0)
        if discount > 0:
            line_total = line_total * (1 - discount / 100)
        grand_total += line_total
        
        # Product details
        details_parts = [f"<b>{item['name']}</b>"]
        details_parts.append(f"<font size='8' color='grey'>SKU: {item['sku']}</font>")
        if item.get("ean"):
            details_parts.append(f"<font size='8' color='grey'>EAN: {item['ean']}</font>")
        
        details_cell = Paragraph("<br/>".join(details_parts), cell_style)
        
        price_text = f"£{item['rate']:.2f}"
        total_text = f"£{line_total:.2f}"
        
        if include_images:
            # Image cell
            sku = item["sku"]
            if sku in image_cache:
                try:
                    img_data = io.BytesIO(image_cache[sku])
                    img = RLImage(img_data, width=22*mm, height=22*mm)
                    img_cell = img
                    print(f"  Added image to PDF for {sku}")
                except Exception as e:
                    print(f"  Error creating image for {sku}: {e}")
                    img_cell = ""
            else:
                img_cell = ""
            
            row = [img_cell, details_cell, str(item["quantity"]), price_text, total_text]
        else:
            row = [details_cell, str(item["quantity"]), price_text, total_text]
        
        table_data.append(row)
    
    # Create table
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    elements.append(table)
    elements.append(Spacer(1, 10*mm))
    
    # Grand total
    total_style = ParagraphStyle('Total', parent=styles['Normal'], fontSize=12, alignment=TA_RIGHT)
    elements.append(Paragraph(f"<b>TOTAL: £{grand_total:,.2f}</b>", total_style))
    
    # Build PDF
    print("Building PDF...")
    doc.build(elements)
    buffer.seek(0)
    
    pdf_size = buffer.getbuffer().nbytes
    print(f"SUCCESS! PDF generated: {pdf_size} bytes")
    
    # Save to file for inspection
    with open("/Users/matt/Desktop/test_quote.pdf", "wb") as f:
        f.write(buffer.read())
    print("Saved to /Users/matt/Desktop/test_quote.pdf")
    
    return True

if __name__ == "__main__":
    test_pdf_generation()
