// Sync service - handles downloading data for offline use

import * as offlineStore from './offlineStore'

const API_BASE = '/api'

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
    return products.length
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

// Pre-cache product images (optional, can be slow)
export async function syncImages(products, onProgress) {
  console.log('SYNC: Starting image sync...')
  
  await offlineStore.clearImages()
  
  let cached = 0
  const total = products.length
  
  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    
    if (i % 10 === 0) {
      onProgress?.({ 
        stage: 'images', 
        current: i, 
        total,
        message: `Caching images (${i}/${total})...` 
      })
    }
    
    try {
      const response = await fetch(`/api/products/${product.item_id}/image`)
      if (response.ok) {
        const blob = await response.blob()
        await offlineStore.saveImage(product.item_id, blob)
        cached++
      }
    } catch (err) {
      // Image not available, skip
    }
    
    // Small delay to avoid overwhelming the server
    if (i % 20 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  await offlineStore.setSyncMeta('lastImageSync', new Date().toISOString())
  await offlineStore.setSyncMeta('imageCount', cached)
  
  console.log(`SYNC: Cached ${cached} images`)
  return cached
}

// Full sync - products, customers, and optionally images
export async function fullSync(options = {}, onProgress) {
  const { includeImages = false } = options
  
  const results = {
    products: 0,
    customers: 0,
    images: 0
  }
  
  try {
    // Sync products
    results.products = await syncProducts(onProgress)
    
    // Sync customers
    results.customers = await syncCustomers(onProgress)
    
    // Optionally sync images (can take a long time)
    if (includeImages) {
      const products = await offlineStore.getProducts()
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
