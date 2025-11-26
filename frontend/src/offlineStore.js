// IndexedDB wrapper for offline data storage

const DB_NAME = 'dm-sales-offline'
const DB_VERSION = 1

let db = null

export async function initDB() {
  if (db) return db
  
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
    }
  })
}

// Generic store operations
async function getStore(storeName, mode = 'readonly') {
  const database = await initDB()
  const tx = database.transaction(storeName, mode)
  return tx.objectStore(storeName)
}

// Products
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
    const request = index.get(sku.toUpperCase())
    request.onsuccess = () => resolve(request.result)
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

// Customers
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

// Images - store as base64
export async function saveImage(itemId, imageBlob) {
  const database = await initDB()
  const tx = database.transaction('images', 'readwrite')
  const store = tx.objectStore('images')
  
  // Convert blob to base64
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.readAsDataURL(imageBlob)
  })
  
  store.put({ item_id: itemId, data: base64 })
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getImage(itemId) {
  const store = await getStore('images')
  
  return new Promise((resolve, reject) => {
    const request = store.get(itemId)
    request.onsuccess = () => resolve(request.result?.data)
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

// Pending Orders (offline queue)
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

// Sync metadata
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
