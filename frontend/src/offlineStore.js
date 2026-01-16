// IndexedDB wrapper for offline data storage

const DB_NAME = 'dm-sales-offline'
const DB_VERSION = 2  // Version 2 adds auth store

let db = null

export async function initDB() {
  // Check if existing connection is still valid
  if (db) {
    try {
      // Test if connection is still alive by checking objectStoreNames
      const storeNames = db.objectStoreNames
      if (storeNames && storeNames.contains('images')) {
        return db
      }
    } catch (err) {
      console.warn('initDB: Cached connection is stale, reconnecting...', err)
      db = null
    }
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result
      
      // Products store - keyed by item_id
      if (!database.objectStoreNames.contains('products')) {
        const productStore = database.createObjectStore('products', { keyPath: 'item_id' })
        productStore.createIndex('sku', 'sku', { unique: false })
        productStore.createIndex('ean', 'ean', { unique: false })
        productStore.createIndex('brand', 'brand', { unique: false })
      }
      
      // Customers store - keyed by contact_id
      if (!database.objectStoreNames.contains('customers')) {
        const customerStore = database.createObjectStore('customers', { keyPath: 'contact_id' })
        customerStore.createIndex('company_name', 'company_name', { unique: false })
      }
      
      // Images store - keyed by item_id, stores base64
      if (!database.objectStoreNames.contains('images')) {
        database.createObjectStore('images', { keyPath: 'item_id' })
      }
      
      // Offline orders queue - orders created while offline
      if (!database.objectStoreNames.contains('pendingOrders')) {
        const orderStore = database.createObjectStore('pendingOrders', { keyPath: 'id', autoIncrement: true })
        orderStore.createIndex('created_at', 'created_at', { unique: false })
      }
      
      // Sync metadata
      if (!database.objectStoreNames.contains('syncMeta')) {
        database.createObjectStore('syncMeta', { keyPath: 'key' })
      }
      
      // Auth store for offline login
      if (!database.objectStoreNames.contains('auth')) {
        database.createObjectStore('auth', { keyPath: 'agentId' })
      }
    }
  })
}

// Generic store operations
async function getStore(storeName, mode = 'readonly') {
  const database = await initDB()
  const tx = database.transaction(storeName, mode)
  return tx.objectStore(storeName)
}

// ============ Auth Functions ============

export async function saveAgentCredentials(agentId, pin, agentData) {
  const database = await initDB()
  const tx = database.transaction('auth', 'readwrite')
  const store = tx.objectStore('auth')
  
  // Store with base64 encoded PIN (simple obfuscation for offline use)
  const pinHash = btoa(pin)
  store.put({ 
    agentId, 
    pinHash, 
    agentData, 
    savedAt: new Date().toISOString() 
  })
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function verifyOfflineCredentials(agentId, pin) {
  try {
    const database = await initDB()
    const tx = database.transaction('auth', 'readonly')
    const store = tx.objectStore('auth')
    
    return new Promise((resolve, reject) => {
      const request = store.get(agentId)
      request.onsuccess = () => {
        const record = request.result
        if (record && record.pinHash === btoa(pin)) {
          resolve(record.agentData)
        } else {
          resolve(null)
        }
      }
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Offline auth check failed:', err)
    return null
  }
}

export async function getStoredAgents() {
  try {
    const database = await initDB()
    const tx = database.transaction('auth', 'readonly')
    const store = tx.objectStore('auth')
    
    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    return []
  }
}

// ============ Products ============

export async function saveProducts(products) {
  const database = await initDB()
  const tx = database.transaction('products', 'readwrite')
  const store = tx.objectStore('products')
  
  for (const product of products) {
    store.put(product)
  }
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getProducts(options = {}) {
  const store = await getStore('products')
  
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => {
      let products = request.result
      
      // Filter by brand if specified
      if (options.brand) {
        products = products.filter(p => 
          p.brand?.toLowerCase().includes(options.brand.toLowerCase())
        )
      }
      
      // Search filter
      if (options.search) {
        const searchLower = options.search.toLowerCase()
        products = products.filter(p =>
          p.name?.toLowerCase().includes(searchLower) ||
          p.sku?.toLowerCase().includes(searchLower) ||
          p.ean?.toLowerCase().includes(searchLower)
        )
      }
      
      // Sort by name
      products.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      
      resolve(products)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function getProductByEAN(ean) {
  const store = await getStore('products')
  const index = store.index('ean')
  
  return new Promise((resolve, reject) => {
    const request = index.get(ean)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getProductBySKU(sku) {
  const store = await getStore('products')
  const index = store.index('sku')
  
  return new Promise((resolve, reject) => {
    // Try exact match first
    const request = index.get(sku.toUpperCase())
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result)
      } else {
        // Try case-insensitive search through all
        const allRequest = store.getAll()
        allRequest.onsuccess = () => {
          const skuUpper = sku.toUpperCase()
          const found = allRequest.result.find(p => p.sku?.toUpperCase() === skuUpper)
          resolve(found || null)
        }
        allRequest.onerror = () => reject(allRequest.error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

export async function clearProducts() {
  const store = await getStore('products', 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// Update only stock levels (lightweight sync)
export async function updateStockLevels(stockData) {
  const database = await initDB()
  const tx = database.transaction('products', 'readwrite')
  const store = tx.objectStore('products')
  
  for (const item of stockData) {
    // Get existing product and update stock only
    const getRequest = store.get(item.item_id)
    getRequest.onsuccess = () => {
      const product = getRequest.result
      if (product) {
        product.stock_on_hand = item.stock_on_hand
        store.put(product)
      }
    }
  }
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ============ Customers ============

export async function saveCustomers(customers) {
  const database = await initDB()
  const tx = database.transaction('customers', 'readwrite')
  const store = tx.objectStore('customers')
  
  for (const customer of customers) {
    store.put(customer)
  }
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCustomers(search = '') {
  const store = await getStore('customers')
  
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => {
      let customers = request.result
      
      if (search) {
        const searchLower = search.toLowerCase()
        customers = customers.filter(c =>
          c.company_name?.toLowerCase().includes(searchLower) ||
          c.contact_name?.toLowerCase().includes(searchLower) ||
          c.email?.toLowerCase().includes(searchLower)
        )
      }
      
      customers.sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''))
      resolve(customers)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function clearCustomers() {
  const store = await getStore('customers', 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// ============ Images ============

export async function saveImage(itemId, imageBlob) {
  console.log('offlineStore.saveImage: Saving image for', itemId, 'blob size:', imageBlob.size)
  
  // IMPORTANT: Convert blob to base64 BEFORE starting the transaction
  // IndexedDB transactions auto-commit when the event loop goes idle,
  // so any async operations (like FileReader) must complete before opening the transaction
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.readAsDataURL(imageBlob)
  })
  
  console.log('offlineStore.saveImage: Converted to base64, length:', base64.length)
  
  // Now open the transaction and store synchronously
  const database = await initDB()
  console.log('offlineStore.saveImage: Got database, stores:', Array.from(database.objectStoreNames))

  const tx = database.transaction('images', 'readwrite')
  const store = tx.objectStore('images')

  const putRequest = store.put({ item_id: itemId, data: base64 })
  putRequest.onsuccess = () => console.log('offlineStore.saveImage: put() succeeded for', itemId)
  putRequest.onerror = () => console.error('offlineStore.saveImage: put() failed for', itemId, putRequest.error)

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      console.log('offlineStore.saveImage: Transaction complete for', itemId)
      resolve()
    }
    tx.onerror = () => {
      console.error('offlineStore.saveImage: Transaction error for', itemId, tx.error)
      reject(tx.error)
    }
    tx.onabort = () => {
      console.error('offlineStore.saveImage: Transaction ABORTED for', itemId, tx.error)
      reject(tx.error || new Error('Transaction aborted'))
    }
  })
}

export async function getImage(itemId) {
  console.log('offlineStore.getImage: Getting image for', itemId)
  const store = await getStore('images')
  
  return new Promise((resolve, reject) => {
    const request = store.get(itemId)
    request.onsuccess = () => {
      const result = request.result
      console.log('offlineStore.getImage: Result for', itemId, '- found:', !!result, result ? `data length: ${result.data?.length}` : '')
      resolve(result?.data)
    }
    request.onerror = () => {
      console.error('offlineStore.getImage: Error for', itemId, request.error)
      reject(request.error)
    }
  })
}

// Debug function to count images in IndexedDB
export async function getImageCount() {
  console.log('getImageCount: Starting count...')
  try {
    const database = await initDB()
    console.log('getImageCount: Got database, stores:', Array.from(database.objectStoreNames))

    const tx = database.transaction('images', 'readonly')
    const store = tx.objectStore('images')

    return new Promise((resolve, reject) => {
      const request = store.count()
      request.onsuccess = () => {
        console.log('getImageCount: IndexedDB reports', request.result, 'images')
        resolve(request.result)
      }
      request.onerror = () => {
        console.error('getImageCount: Error', request.error)
        reject(request.error)
      }
    })
  } catch (err) {
    console.error('getImageCount: Failed to get store', err)
    return 0
  }
}

// Debug function to list all image IDs
export async function listImageIds() {
  const store = await getStore('images')
  return new Promise((resolve, reject) => {
    const request = store.getAllKeys()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function clearImages() {
  const store = await getStore('images', 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// ============ Pending Orders ============

export async function savePendingOrder(orderData) {
  const database = await initDB()
  const tx = database.transaction('pendingOrders', 'readwrite')
  const store = tx.objectStore('pendingOrders')
  
  store.add({
    ...orderData,
    created_at: new Date().toISOString()
  })
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getPendingOrders() {
  const store = await getStore('pendingOrders')
  
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function deletePendingOrder(id) {
  const store = await getStore('pendingOrders', 'readwrite')
  
  return new Promise((resolve, reject) => {
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// ============ Sync Metadata ============

export async function setSyncMeta(key, value) {
  const database = await initDB()
  const tx = database.transaction('syncMeta', 'readwrite')
  const store = tx.objectStore('syncMeta')
  
  store.put({ key, value, updated_at: new Date().toISOString() })
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getSyncMeta(key) {
  const store = await getStore('syncMeta')
  
  return new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result?.value)
    request.onerror = () => reject(request.error)
  })
}

// Check if we have offline data
export async function hasOfflineData() {
  try {
    const lastSync = await getSyncMeta('lastProductSync')
    return !!lastSync
  } catch {
    return false
  }
}

// Clear all offline data
export async function clearAllData() {
  await clearProducts()
  await clearCustomers()
  await clearImages()
  const store = await getStore('syncMeta', 'readwrite')
  await new Promise((resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
