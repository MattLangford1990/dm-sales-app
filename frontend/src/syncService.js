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

// Download all products for offline use
export async function syncProducts(onProgress) {
  console.log('SYNC: Starting product sync...')
  
  onProgress?.({ stage: 'products', message: 'Downloading products...' })
  
  // Clear existing products
  await offlineStore.clearProducts()
  
  try {
    const data = await apiRequest('/products/sync')
    const products = data.products || []
    
    if (products.length > 0) {
      await offlineStore.saveProducts(products)
    }
    
    await offlineStore.setSyncMeta('lastProductSync', new Date().toISOString())
    await offlineStore.setSyncMeta('productCount', products.length)
    
    console.log(`SYNC: Downloaded ${products.length} products`)
    return products
  } catch (err) {
    console.error('SYNC: Error fetching products', err)
    throw err
  }
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

// Pre-cache product images for offline use
// Downloads via our API (which caches on server) and saves to IndexedDB
export async function syncImages(products, onProgress) {
  console.log('SYNC: Starting image sync...')
  
  const token = localStorage.getItem('token')
  let cached = 0
  let skipped = 0
  let failed = 0
  const total = products.length
  const BATCH_SIZE = 5 // Smaller batches to avoid overwhelming the API
  
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
        try {
          // Check if we already have this image cached
          const existing = await offlineStore.getImage(product.item_id)
          if (existing) {
            return { status: 'skipped' }
          }
          
          // Download from our API (which handles Zoho auth)
          const response = await fetch(`${API_BASE}/products/${product.item_id}/image`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          })
          
          if (response.ok) {
            const blob = await response.blob()
            // Only save if it's actually an image
            if (blob.type.startsWith('image/') && blob.size > 100) {
              await offlineStore.saveImage(product.item_id, blob)
              return { status: 'cached' }
            }
          }
          return { status: 'noimage' }
        } catch (err) {
          return { status: 'failed' }
        }
      })
    )
    
    // Count results
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        if (r.value.status === 'cached') cached++
        else if (r.value.status === 'skipped') skipped++
        else failed++ // includes 'noimage' and 'failed'
      } else {
        failed++
      }
    })
    
    // Small delay between batches to be nice to the server
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  const totalCached = cached + skipped
  await offlineStore.setSyncMeta('lastImageSync', new Date().toISOString())
  await offlineStore.setSyncMeta('imageCount', totalCached)
  
  console.log(`SYNC: Images - ${cached} new, ${skipped} already cached, ${failed} no image/failed`)
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
  const [lastProductSync, productCount, lastCustomerSync, customerCount, lastImageSync, imageCount, lastStockSync] = 
    await Promise.all([
      offlineStore.getSyncMeta('lastProductSync'),
      offlineStore.getSyncMeta('productCount'),
      offlineStore.getSyncMeta('lastCustomerSync'),
      offlineStore.getSyncMeta('customerCount'),
      offlineStore.getSyncMeta('lastImageSync'),
      offlineStore.getSyncMeta('imageCount'),
      offlineStore.getSyncMeta('lastStockSync')
    ])
  
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
