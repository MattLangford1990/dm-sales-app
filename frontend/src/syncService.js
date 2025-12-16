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
  ? 'https://appdmbrands.com/api/products/feed'
  : '/api/products/feed'

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

// Cloudinary CDN - low res for offline storage
const CLOUDINARY_BASE = 'https://res.cloudinary.com/dcfbgveei/image/upload'
const CLOUDINARY_TRANSFORM = 'w_300,q_60,f_auto' // Same as 'small' in App.jsx

// Convert SKU to Cloudinary format (dots -> underscores for My Flame products)
const skuToCloudinaryId = (sku) => {
  if (!sku) return null
  return sku.replace(/\./g, '_')
}

// Pre-cache product images for offline use
// Downloads from Cloudinary CDN (fast, no rate limits) and saves to IndexedDB
export async function syncImages(products, onProgress) {
  console.log('SYNC: Starting image sync from Cloudinary...')
  console.log('SYNC: Products to sync:', products.length)
  
  let cached = 0
  let skipped = 0
  let failed = 0
  let noimage = 0
  const total = products.length
  const BATCH_SIZE = 10 // Cloudinary can handle more concurrent requests than our API
  
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE)
    
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
          
          // Download from Cloudinary CDN
          const cloudinarySku = skuToCloudinaryId(sku)
          const url = `${CLOUDINARY_BASE}/${CLOUDINARY_TRANSFORM}/products/${cloudinarySku}.jpg`
          
          const response = await fetch(url)
          
          if (response.ok) {
            const blob = await response.blob()
            
            // Only save if it's actually an image with content
            if (blob.type.startsWith('image/') && blob.size > 500) {
              await offlineStore.saveImage(sku, blob)
              return { status: 'cached', sku }
            } else {
              return { status: 'noimage', sku }
            }
          } else {
            // 404 = no image for this product
            return { status: 'noimage', sku }
          }
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
  const imageCount = await offlineStore.getImageCount()
  
  const pendingOrders = await offlineStore.getPendingOrders()
  
  return {
    lastProductSync,
    productCount: productCount || 0,
    lastCustomerSync,
    customerCount: customerCount || 0,
    lastImageSync,
    imageCount: imageCount || 0,
    lastStockSync,
    pendingOrderCount: pendingOrders.length
  }
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
