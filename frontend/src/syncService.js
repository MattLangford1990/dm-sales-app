// Sync service - handles downloading data for offline use

import * as offlineStore from './offlineStore'

// Use full URL for native app, relative path for web
const isNativeApp = window.Capacitor?.isNativePlatform?.() || false
const API_BASE = isNativeApp ? 'https://appdmbrands.com/api' : '/api'

async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token')
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  })
  
  if (!response.ok) {
    throw new Error('Request failed')
  }
  
  return response.json()
}

// Static product feed URL - served from API, updated every 4 hours
const PRODUCT_FEED_URL = isNativeApp 
  ? 'https://appdmbrands.com/api/feed/products'
  : '/api/feed/products'

// Download all products for offline use
// Uses static CDN feed (fast, no API calls) with fallback to live API
export async function syncProducts(onProgress) {
  console.log('SYNC: Starting product sync...')
  
  onProgress?.({ stage: 'products', message: 'Downloading products...' })
  
  // Clear existing products
  await offlineStore.clearProducts()
  
  let products = []
  let source = 'unknown'
  
  // Try static CDN feed first (fast, no API calls)
  try {
    console.log('SYNC: Trying static CDN feed...')
    const feedResponse = await fetch(PRODUCT_FEED_URL, { cache: 'no-cache' })
    
    if (feedResponse.ok) {
      const feedData = await feedResponse.json()
      products = feedData.products || []
      source = 'cdn'
      console.log(`SYNC: Got ${products.length} products from CDN feed (generated: ${feedData.generated_at})`)
    }
  } catch (feedErr) {
    console.warn('SYNC: CDN feed failed, will try API:', feedErr.message)
  }
  
  // Fall back to live API if CDN feed failed or was empty
  if (products.length === 0) {
    try {
      console.log('SYNC: Falling back to live API...')
      const data = await apiRequest('/products/sync')
      products = data.products || []
      source = 'api'
      console.log(`SYNC: Got ${products.length} products from API`)
    } catch (err) {
      console.error('SYNC: Error fetching products from API', err)
      throw err
    }
  }
  
  if (products.length > 0) {
    await offlineStore.saveProducts(products)
  }
  
  await offlineStore.setSyncMeta('lastProductSync', new Date().toISOString())
  await offlineStore.setSyncMeta('productCount', products.length)
  await offlineStore.setSyncMeta('productSource', source)
  
  console.log(`SYNC: Downloaded ${products.length} products from ${source}`)
  return products
}

// Lightweight stock-only sync (~50KB vs 1MB for full sync)
export async function syncStock(onProgress) {
  console.log('SYNC: Starting stock sync...')
  
  onProgress?.({ stage: 'stock', message: 'Updating stock levels...' })
  
  try {
    const data = await apiRequest('/products/stock')
    const stockData = data.stock || []
    
    // Update stock levels in existing products
    if (stockData.length > 0) {
      await offlineStore.updateStockLevels(stockData)
    }
    
    await offlineStore.setSyncMeta('lastStockSync', new Date().toISOString())
    
    console.log(`SYNC: Updated ${stockData.length} stock levels`)
    return stockData.length
  } catch (err) {
    console.error('SYNC: Error fetching stock', err)
    throw err
  }
}

// Download all customers for offline use
export async function syncCustomers(onProgress) {
  console.log('SYNC: Starting customer sync...')
  
  onProgress?.({ stage: 'customers', message: 'Downloading customers...' })
  
  // Clear existing customers
  await offlineStore.clearCustomers()
  
  try {
    const data = await apiRequest('/customers/sync')
    const customers = data.customers || []
    
    if (customers.length > 0) {
      await offlineStore.saveCustomers(customers)
    }
    
    await offlineStore.setSyncMeta('lastCustomerSync', new Date().toISOString())
    await offlineStore.setSyncMeta('customerCount', customers.length)
    
    console.log(`SYNC: Downloaded ${customers.length} customers`)
    return customers.length
  } catch (err) {
    console.error('SYNC: Error fetching customers', err)
    throw err
  }
}

// API base for image proxy (handles CORS)
const getApiBase = () => {
  return window.Capacitor?.isNativePlatform?.() ? 'https://appdmbrands.com/api' : '/api'
}

// Brand variations for matching (same as backend agents.py)
const BRAND_VARIATIONS = {
  'Räder': ['Räder', 'Rader', 'raeder', 'Räder Design'],
  'Remember': ['Remember', 'Remember Products'],
  'My Flame': ['My Flame', 'MyFlame', 'My Flame Lifestyle'],
  'Relaxound': ['Relaxound'],
  'PPD': ['PPD', 'Paper Products Design', 'paperproducts design', 'ppd PAPERPRODUCTS DESIGN'],
  'Ideas4Seasons': ['Ideas4Seasons', 'Ideas 4 Seasons', 'i4s', 'Ideas4seasons'],
  'Elvang': ['Elvang', 'Elvang Denmark'],
}

// Check if a product matches any of the agent's brands
function productMatchesBrands(product, agentBrands) {
  if (!agentBrands || agentBrands.length === 0) return true // No filter if no brands
  
  const productBrand = (product.brand || '').toLowerCase()
  
  for (const agentBrand of agentBrands) {
    // Get all variations for this brand
    const variations = BRAND_VARIATIONS[agentBrand] || [agentBrand]
    
    for (const variation of variations) {
      if (productBrand.includes(variation.toLowerCase())) {
        return true
      }
    }
  }
  
  return false
}

// Pre-cache product images for offline use
// Downloads via API proxy and saves to IndexedDB
// Only downloads images for the agent's assigned brands
export async function syncImages(products, onProgress) {
  console.log('SYNC: Starting image sync...')
  
  // Helper function to compress image before storing
  const compressImage = async (blob) => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        // Resize to max 500px (good quality for all screens)
        const maxSize = 500
        let width = img.width
        let height = img.height
        
        // Only resize if larger than maxSize
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height * maxSize) / width
            width = maxSize
          } else {
            width = (width * maxSize) / height
            height = maxSize
          }
        }
        
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        
        // Export as JPEG at 80% quality
        canvas.toBlob((compressedBlob) => {
          resolve(compressedBlob)
        }, 'image/jpeg', 0.8)
      }
      img.onerror = () => resolve(blob) // Return original if compression fails
      img.src = URL.createObjectURL(blob)
    })
  }
  
  // Get agent's brands from localStorage
  let agentBrands = []
  try {
    const agentData = localStorage.getItem('agent')
    if (agentData) {
      const agent = JSON.parse(agentData)
      agentBrands = agent.brands || []
    }
  } catch (err) {
    console.warn('SYNC: Could not get agent brands, will sync all images')
  }
  
  // Filter products to only agent's brands
  const filteredProducts = agentBrands.length > 0
    ? products.filter(p => productMatchesBrands(p, agentBrands))
    : products
  
  console.log(`SYNC: Agent brands: ${agentBrands.join(', ') || 'ALL'}`)
  console.log(`SYNC: Products to sync: ${filteredProducts.length} (filtered from ${products.length})`)
  
  let cached = 0
  let skipped = 0
  let failed = 0
  let noimage = 0
  const total = filteredProducts.length
  const BATCH_SIZE = 5 // Reasonable batch size for API proxy
  
  for (let i = 0; i < filteredProducts.length; i += BATCH_SIZE) {
    const batch = filteredProducts.slice(i, i + BATCH_SIZE)
    
    onProgress?.({ 
      stage: 'images', 
      current: i, 
      total,
      message: `Downloading images (${i}/${total})...` 
    })
    
    // Download batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (product) => {
        const sku = product.sku
        if (!sku) {
          return { status: 'noimage', sku: 'no-sku' }
        }
        
        try {
          // Check if we already have this image cached (by SKU)
          const existing = await offlineStore.getImage(sku)
          if (existing) {
            return { status: 'skipped', sku }
          }
          
          // Download via API proxy (handles CORS and jpg/png fallback)
          const apiBase = getApiBase()
          const url = `${apiBase}/cdn/image/${sku}`
          const response = await fetch(url)

          if (response.ok) {
            const blob = await response.blob()
            // Only save if it has content
            if (blob.size > 500) {
              // Compress before storing (500px max, 80% JPEG)
              const compressedBlob = await compressImage(blob)
              console.log('SYNC:', sku, '- original:', blob.size, 'compressed:', compressedBlob.size)
              await offlineStore.saveImage(sku, compressedBlob)
              return { status: 'cached', sku }
            }
          }

          // No image found
          return { status: 'noimage', sku }
        } catch (err) {
          console.error('SYNC: Error for product', sku, err)
          return { status: 'failed', sku, error: err.message }
        }
      })
    )
    
    // Count results
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        if (r.value.status === 'cached') cached++
        else if (r.value.status === 'skipped') skipped++
        else if (r.value.status === 'noimage') noimage++
        else failed++
      } else {
        console.error('SYNC: Promise rejected:', r.reason)
        failed++
      }
    })
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  const totalCached = cached + skipped
  await offlineStore.setSyncMeta('lastImageSync', new Date().toISOString())
  await offlineStore.setSyncMeta('imageCount', totalCached)
  
  console.log(`SYNC: Images complete - ${cached} new, ${skipped} already cached, ${noimage} no image, ${failed} failed`)
  return totalCached
}

// Full sync - products and customers (images are separate to save API calls)
export async function fullSync(options = {}, onProgress) {
  const { includeImages = false } = options // Images OFF by default - use syncImages separately
  
  const results = {
    products: 0,
    customers: 0,
    images: 0
  }
  
  try {
    // Sync products (returns the product array now)
    const products = await syncProducts(onProgress)
    results.products = products.length
    
    // Sync customers
    results.customers = await syncCustomers(onProgress)
    
    // Only sync images if explicitly requested
    if (includeImages && products.length > 0) {
      results.images = await syncImages(products, onProgress)
    }
    
    await offlineStore.setSyncMeta('lastFullSync', new Date().toISOString())
    
    onProgress?.({ stage: 'complete', message: 'Sync complete!' })
    
    return results
  } catch (err) {
    console.error('SYNC: Full sync failed', err)
    throw err
  }
}

// Submit pending orders when back online
export async function submitPendingOrders(onProgress) {
  const pendingOrders = await offlineStore.getPendingOrders()
  
  if (pendingOrders.length === 0) {
    return { submitted: 0, failed: 0 }
  }
  
  console.log(`SYNC: Submitting ${pendingOrders.length} pending orders...`)
  
  let submitted = 0
  let failed = 0
  
  for (const order of pendingOrders) {
    onProgress?.({ 
      message: `Submitting order ${submitted + failed + 1} of ${pendingOrders.length}...` 
    })
    
    try {
      await apiRequest('/orders', {
        method: 'POST',
        body: JSON.stringify(order.orderData)
      })
      
      // Remove from pending queue
      await offlineStore.deletePendingOrder(order.id)
      submitted++
    } catch (err) {
      console.error('SYNC: Failed to submit order', order.id, err)
      failed++
    }
  }
  
  console.log(`SYNC: Submitted ${submitted} orders, ${failed} failed`)
  return { submitted, failed }
}

// Get sync status
export async function getSyncStatus() {
  console.log('getSyncStatus: Fetching sync status...')
  
  const [lastProductSync, productCount, lastCustomerSync, customerCount, lastImageSync, lastStockSync] = 
    await Promise.all([
      offlineStore.getSyncMeta('lastProductSync'),
      offlineStore.getSyncMeta('productCount'),
      offlineStore.getSyncMeta('lastCustomerSync'),
      offlineStore.getSyncMeta('customerCount'),
      offlineStore.getSyncMeta('lastImageSync'),
      offlineStore.getSyncMeta('lastStockSync')
    ])
  
  // Get actual image count from IndexedDB (more reliable than meta)
  console.log('getSyncStatus: Getting image count from IndexedDB...')
  const imageCount = await offlineStore.getImageCount()
  console.log('getSyncStatus: Image count returned:', imageCount)
  
  const pendingOrders = await offlineStore.getPendingOrders()
  
  const status = {
    lastProductSync,
    productCount: productCount || 0,
    lastCustomerSync,
    customerCount: customerCount || 0,
    lastImageSync,
    imageCount: imageCount || 0,
    lastStockSync,
    pendingOrderCount: pendingOrders.length
  }
  
  console.log('getSyncStatus: Returning', status)
  return status
}

// Check if online
export function isOnline() {
  return navigator.onLine
}

// Listen for online/offline events
export function onNetworkChange(callback) {
  window.addEventListener('online', () => callback(true))
  window.addEventListener('offline', () => callback(false))
  
  // Return cleanup function
  return () => {
    window.removeEventListener('online', () => callback(true))
    window.removeEventListener('offline', () => callback(false))
  }
}
