import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import * as offlineStore from './offlineStore'
import * as syncService from './syncService'

// API helpers
// In native app, use the deployed backend URL. In browser, use relative path (proxied in dev)
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
  
  if (response.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('agent')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || 'Request failed')
  }
  
  return response.json()
}

// Auth Context
const AuthContext = createContext(null)

function AuthProvider({ children }) {
  const [agent, setAgent] = useState(() => {
    const saved = localStorage.getItem('agent')
    return saved ? JSON.parse(saved) : null
  })
  const [isAdmin, setIsAdmin] = useState(() => {
    const saved = localStorage.getItem('isAdmin')
    return saved === 'true'
  })
  
  // Check admin status on mount if logged in
  useEffect(() => {
    if (agent && navigator.onLine) {
      apiRequest('/auth/me').then(data => {
        setIsAdmin(data.is_admin || false)
        localStorage.setItem('isAdmin', data.is_admin ? 'true' : 'false')
      }).catch(() => {})
    }
  }, [])
  
  const login = async (agentId, pin) => {
    // Try online login first
    if (navigator.onLine) {
      try {
        const data = await apiRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ agent_id: agentId, pin })
        })
        
        localStorage.setItem('token', data.access_token)
        localStorage.setItem('agent', JSON.stringify({
          name: data.agent_name,
          brands: data.brands
        }))
        setAgent({ name: data.agent_name, brands: data.brands })
        
        // Check admin status
        try {
          const meData = await apiRequest('/auth/me')
          setIsAdmin(meData.is_admin || false)
          localStorage.setItem('isAdmin', meData.is_admin ? 'true' : 'false')
        } catch (err) {
          console.warn('Failed to check admin status')
        }
        
        // Save credentials for offline use
        try {
          await offlineStore.saveAgentCredentials(agentId, pin, {
            name: data.agent_name,
            brands: data.brands,
            token: data.access_token
          })
          console.log('Saved credentials for offline use')
        } catch (err) {
          console.warn('Failed to save offline credentials:', err)
        }
        
        // Auto-sync products/customers in background after login (no images - too slow for background)
        console.log('Login successful - triggering background sync')
        syncService.fullSync({ includeImages: false }).catch(err => {
          console.warn('Background sync after login failed:', err)
        })
        
        return data
      } catch (err) {
        // If online but login failed, don't fall back to offline
        throw err
      }
    }
    
    // Offline - try local credentials
    console.log('Attempting offline login...')
    const offlineData = await offlineStore.verifyOfflineCredentials(agentId, pin)
    
    if (offlineData) {
      localStorage.setItem('token', offlineData.token || 'offline-token')
      localStorage.setItem('agent', JSON.stringify({
        name: offlineData.name,
        brands: offlineData.brands
      }))
      setAgent({ name: offlineData.name, brands: offlineData.brands })
      
      return {
        access_token: offlineData.token || 'offline-token',
        agent_name: offlineData.name,
        brands: offlineData.brands
      }
    }
    
    throw new Error('Invalid credentials or no offline data available. Please login online first.')
  }
  
  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('agent')
    localStorage.removeItem('isAdmin')
    setAgent(null)
    setIsAdmin(false)
  }
  
  return (
    <AuthContext.Provider value={{ agent, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

const useAuth = () => useContext(AuthContext)

// Cart Context
const CartContext = createContext(null)

function CartProvider({ children }) {
  // Initialize cart from localStorage
  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem('cart')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  
  // Initialize customer from localStorage
  const [customer, setCustomer] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedCustomer')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  
  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart))
  }, [cart])
  
  // Persist customer to localStorage whenever it changes
  useEffect(() => {
    if (customer) {
      localStorage.setItem('selectedCustomer', JSON.stringify(customer))
    } else {
      localStorage.removeItem('selectedCustomer')
    }
  }, [customer])
  
  const addToCart = (product, quantity = 1) => {
    setCart(prev => {
      const existing = prev.find(item => item.item_id === product.item_id)
      if (existing) {
        return prev.map(item =>
          item.item_id === product.item_id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      }
      return [...prev, { ...product, quantity, discount: 0 }]
    })
  }
  
  const updateQuantity = (itemId, quantity) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => item.item_id !== itemId))
    } else {
      setCart(prev => prev.map(item =>
        item.item_id === itemId ? { ...item, quantity } : item
      ))
    }
  }
  
  const updateDiscount = (itemId, discount) => {
    setCart(prev => prev.map(item =>
      item.item_id === itemId ? { ...item, discount: Math.max(0, Math.min(100, discount)) } : item
    ))
  }
  
  const clearCart = () => {
    setCart([])
    setCustomer(null)
    // Also clear from localStorage
    localStorage.removeItem('cart')
    localStorage.removeItem('selectedCustomer')
  }
  
  const cartTotal = cart.reduce((sum, item) => {
    const itemTotal = item.rate * item.quantity
    const discountAmount = itemTotal * (item.discount / 100)
    return sum + (itemTotal - discountAmount)
  }, 0)
  
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  
  return (
    <CartContext.Provider value={{
      cart, customer, setCustomer,
      addToCart, updateQuantity, updateDiscount, clearCart,
      cartTotal, cartCount
    }}>
      {children}
    </CartContext.Provider>
  )
}

const useCart = () => useContext(CartContext)

// Toast Context for notifications
const ToastContext = createContext(null)

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  
  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])
  
  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-xl shadow-lg text-white font-medium animate-slide-in ${
              toast.type === 'success' ? 'bg-green-600' :
              toast.type === 'error' ? 'bg-red-600' :
              'bg-blue-600'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const useToast = () => useContext(ToastContext)

// Offline Context
const OfflineContext = createContext(null)

function OfflineProvider({ children }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncStatus, setSyncStatus] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const stockIntervalRef = useRef(null)
  
  const refreshSyncStatus = async () => {
    const status = await syncService.getSyncStatus()
    setSyncStatus(status)
    return status
  }
  
  // Auto-sync when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true)
      console.log('Back online - triggering auto-sync')
      // Small delay to let connection stabilize
      setTimeout(async () => {
        try {
          await doSync()
        } catch (err) {
          console.error('Auto-sync on reconnect failed:', err)
        }
      }, 2000)
    }
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Load sync status on mount
    refreshSyncStatus()
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  
  // Stock refresh every 60 minutes
  useEffect(() => {
    const startStockRefresh = () => {
      // Clear any existing interval
      if (stockIntervalRef.current) {
        clearInterval(stockIntervalRef.current)
      }
      
      // Set up 60-minute interval
      stockIntervalRef.current = setInterval(async () => {
        if (navigator.onLine && localStorage.getItem('token')) {
          console.log('60-min stock refresh triggered')
          try {
            await syncService.syncStock()
            await refreshSyncStatus()
          } catch (err) {
            console.error('Stock refresh failed:', err)
          }
        }
      }, 60 * 60 * 1000) // 60 minutes
    }
    
    startStockRefresh()
    
    return () => {
      if (stockIntervalRef.current) {
        clearInterval(stockIntervalRef.current)
      }
    }
  }, [])
  
  const doSync = async (onProgress) => {
    setIsSyncing(true)
    try {
      // includeImages: false - images load on-demand to save API calls
      await syncService.fullSync({ includeImages: false }, onProgress)
      await refreshSyncStatus()
    } finally {
      setIsSyncing(false)
    }
  }
  
  const doStockSync = async () => {
    if (!navigator.onLine) return
    try {
      await syncService.syncStock()
      await refreshSyncStatus()
    } catch (err) {
      console.error('Stock sync failed:', err)
    }
  }
  
  const submitPendingOrders = async () => {
    if (!isOnline) return { submitted: 0, failed: 0 }
    const result = await syncService.submitPendingOrders()
    await refreshSyncStatus()
    return result
  }
  
  return (
    <OfflineContext.Provider value={{
      isOnline,
      syncStatus,
      isSyncing,
      doSync,
      doStockSync,
      submitPendingOrders,
      refreshSyncStatus
    }}>
      {children}
    </OfflineContext.Provider>
  )
}

const useOffline = () => useContext(OfflineContext)

// Barcode Scanner Hook
function useBarcodeScanner(onScan) {
  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)
  
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ignore if user is typing in an input field
      const activeEl = document.activeElement
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
      
      if (isTyping) {
        bufferRef.current = ''
        return
      }
      
      const now = Date.now()
      
      // If more than 100ms since last key, reset buffer (manual typing)
      if (now - lastKeyTimeRef.current > 100) {
        bufferRef.current = ''
      }
      lastKeyTimeRef.current = now
      
      // Enter key triggers scan
      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 3) {
          // We have a barcode!
          e.preventDefault()
          onScan(bufferRef.current)
        }
        bufferRef.current = ''
        return
      }
      
      // Only capture alphanumeric characters
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        bufferRef.current += e.key
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [onScan])
}

// Components
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
    </div>
  )
}

// Offline-aware image component - checks IndexedDB cache first, fetches from API if needed
// Each image only fetched ONCE, then cached forever in IndexedDB
function OfflineImage({ itemId, imageUrl, alt, className, fallbackIcon = '📦' }) {
  const [imageSrc, setImageSrc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  
  useEffect(() => {
    if (!itemId) {
      console.log('OfflineImage: No itemId provided')
      setLoading(false)
      setFailed(true)
      return
    }
    
    let mounted = true
    setLoading(true)
    setFailed(false)
    setImageSrc(null)
    
    const loadImage = async () => {
      console.log('OfflineImage: Loading image for', itemId, 'online:', navigator.onLine)
      
      // 1. Check IndexedDB cache first (no API call)
      try {
        const cachedImage = await offlineStore.getImage(itemId)
        console.log('OfflineImage: Cache check for', itemId, '- found:', !!cachedImage, cachedImage ? `(${cachedImage.substring(0, 50)}...)` : '')
        if (mounted && cachedImage) {
          setImageSrc(cachedImage)
          setLoading(false)
          return
        }
      } catch (err) {
        console.error('OfflineImage: Cache check failed for', itemId, err)
        // Cache check failed, continue to fetch
      }
      
      // 2. Not in cache - fetch from API (only happens once per image)
      if (!navigator.onLine) {
        // Offline and not cached - show fallback
        console.log('OfflineImage: Offline and not cached for', itemId)
        if (mounted) {
          setLoading(false)
          setFailed(true)
        }
        return
      }
      
      try {
        const token = localStorage.getItem('token')
        console.log('OfflineImage: Fetching from API for', itemId)
        const response = await fetch(`${API_BASE}/products/${itemId}/image`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
        
        if (response.ok) {
          const blob = await response.blob()
          console.log('OfflineImage: Got blob for', itemId, '- size:', blob.size, 'type:', blob.type)
          if (blob.size > 100) {
            // Save to IndexedDB for future use (never fetch again!)
            try {
              await offlineStore.saveImage(itemId, blob)
              console.log('OfflineImage: Saved to cache for', itemId)
            } catch (cacheErr) {
              console.warn('OfflineImage: Failed to cache image:', cacheErr)
            }
            // Convert to base64 for display
            const reader = new FileReader()
            reader.onloadend = () => {
              if (mounted) {
                setImageSrc(reader.result)
                setLoading(false)
              }
            }
            reader.onerror = () => {
              if (mounted) {
                setLoading(false)
                setFailed(true)
              }
            }
            reader.readAsDataURL(blob)
            return
          }
        }
        // No image or failed
        console.log('OfflineImage: No image or failed for', itemId)
        if (mounted) {
          setLoading(false)
          setFailed(true)
        }
      } catch (err) {
        console.error('OfflineImage: Fetch error for', itemId, err)
        if (mounted) {
          setLoading(false)
          setFailed(true)
        }
      }
    }
    
    loadImage()
    
    return () => { mounted = false }
  }, [itemId])
  
  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
      </div>
    )
  }
  
  if (failed || !imageSrc) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <span className="text-4xl">{fallbackIcon}</span>
      </div>
    )
  }
  
  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

function ProductDetailModal({ product, onClose, onAddToCart }) {
  if (!product) return null
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 bg-white/80 rounded-full w-10 h-10 flex items-center justify-center text-2xl z-10 shadow"
          >
            ×
          </button>
          <div className="aspect-square bg-gray-100">
            <OfflineImage
              itemId={product.item_id}
              imageUrl={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain"
              fallbackIcon="📦"
            />
          </div>
        </div>
        
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-500">{product.sku}</p>
          <h2 className="text-xl font-bold text-gray-800">{product.name}</h2>
          
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-primary-600">£{product.rate?.toFixed(2)}</span>
            <span className={`text-sm px-3 py-1 rounded-full ${product.stock_on_hand > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {product.stock_on_hand > 0 ? `${product.stock_on_hand} in stock` : 'Out of stock'}
            </span>
          </div>
          
          {product.pack_qty && (
            <span className="inline-block text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">
              Pack of {product.pack_qty}
            </span>
          )}
          
          {product.description && (
            <p className="text-gray-600 text-sm">{product.description}</p>
          )}
          
          <button
            onClick={() => { onAddToCart(product, product.pack_qty || 1); onClose(); }}
            className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold text-lg hover:bg-primary-700 transition mt-4"
          >
            Add to Cart {product.pack_qty ? `(${product.pack_qty})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function LoginPage() {
  const [agentId, setAgentId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [storedAgents, setStoredAgents] = useState([])
  const { login } = useAuth()
  const navigate = useNavigate()
  
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Load stored agents for offline login
    offlineStore.getStoredAgents().then(agents => {
      setStoredAgents(agents)
    })
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    try {
      await login(agentId, pin)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-plum-500 to-plum-700 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Offline Banner */}
        {!isOnline && (
          <div className="mb-6 p-3 bg-orange-100 border border-orange-200 rounded-xl">
            <div className="flex items-center gap-2 text-orange-800">
              <span className="text-xl">📴</span>
              <span className="font-medium">Offline Mode</span>
            </div>
            <p className="text-sm text-orange-600 mt-1">
              {storedAgents.length > 0 
                ? `${storedAgents.length} agent(s) available for offline login`
                : 'No offline logins available. Connect to internet first.'}
            </p>
          </div>
        )}
        
        <div className="text-center mb-8">
          <img src="/logo.JPG" alt="DMB Logo" className="h-20 mx-auto mb-4 rounded-lg" />
          <h1 className="text-3xl font-bold text-gray-800">DMB Sales</h1>
          <p className="text-gray-500 mt-2">Sign in to continue</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Agent ID</label>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
              placeholder="Enter your agent ID"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
              placeholder="Enter your PIN"
            />
          </div>
          
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={loading || !agentId || !pin || (!isOnline && storedAgents.length === 0)}
            className="w-full bg-primary-600 text-white py-4 rounded-xl font-semibold text-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition touch-target"
          >
            {loading ? 'Signing in...' : isOnline ? 'Sign In' : 'Sign In (Offline)'}
          </button>
          
          {/* Offline agent hints */}
          {!isOnline && storedAgents.length > 0 && (
            <div className="text-center text-sm text-gray-500">
              <p>Available offline: {storedAgents.map(a => a.agentId).join(', ')}</p>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

function HomePage({ onNavigate }) {
  const { agent, logout } = useAuth()
  const { cartCount, cartTotal } = useCart()
  const { syncStatus, isOnline } = useOffline()
  const [catalogues, setCatalogues] = useState([])
  const [loadingCatalogues, setLoadingCatalogues] = useState(false)
  
  // Load catalogues on mount
  useEffect(() => {
    const loadCatalogues = async () => {
      if (!isOnline) return
      setLoadingCatalogues(true)
      try {
        const data = await apiRequest('/catalogues')
        setCatalogues(data.catalogues || [])
      } catch (err) {
        console.error('Failed to load catalogues:', err)
      } finally {
        setLoadingCatalogues(false)
      }
    }
    loadCatalogues()
  }, [isOnline])
  
  const handleDownloadCatalogue = (catalogue) => {
    // Open external URL in new tab
    window.open(catalogue.url, '_blank')
  }
  
  const quickActions = [
    { id: 'products', label: 'Browse Products', icon: '📦', color: 'bg-primary-500' },
    { id: 'quickorder', label: 'Quick Order', icon: '⚡', color: 'bg-peach-400' },
    { id: 'customers', label: 'Customers', icon: '👥', color: 'bg-primary-600' },
    { id: 'cart', label: cartCount > 0 ? `Cart (£${cartTotal.toFixed(0)})` : 'Cart', icon: '🛒', color: 'bg-wine-500', badge: cartCount },
  ]
  
  return (
    <div className="flex-1 bg-gray-100 flex flex-col safe-area-top overflow-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-plum-600 to-plum-500 text-white p-6">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <img src="/logo.JPG" alt="DMB Logo" className="h-14 rounded-xl shadow-lg" />
            <div>
              <h1 className="text-2xl font-bold">Welcome back, {agent?.name?.split(' ')[0]}!</h1>
              <p className="text-plum-200 text-sm">{agent?.brands?.length} brands • DM Brands Ltd</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="text-plum-200 hover:text-white transition text-sm"
          >
            Logout
          </button>
        </div>
        
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{syncStatus?.productCount || 0}</p>
            <p className="text-xs text-plum-200">Products</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{syncStatus?.customerCount || 0}</p>
            <p className="text-xs text-plum-200">Customers</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{cartCount}</p>
            <p className="text-xs text-plum-200">In Cart</p>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 p-4 space-y-4 overflow-auto">
        {/* Quick Actions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map(action => (
              <button
                key={action.id}
                onClick={() => onNavigate(action.id)}
                className={`${action.color} text-white rounded-xl p-4 flex items-center gap-3 transition active:scale-95 relative shadow-md`}
              >
                <span className="text-3xl">{action.icon}</span>
                <span className="font-medium text-left">{action.label}</span>
                {action.badge > 0 && (
                  <span className="absolute top-2 right-2 bg-red-500 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center font-bold">
                    {action.badge > 9 ? '9+' : action.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        
        {/* Catalogues Section */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">📚 Latest Catalogues</h2>
          {loadingCatalogues ? (
            <div className="bg-white rounded-xl p-6 text-center">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin mx-auto"></div>
              <p className="text-sm text-gray-500 mt-2">Loading catalogues...</p>
            </div>
          ) : catalogues.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center text-gray-500">
              <p className="text-4xl mb-2">📄</p>
              <p>{isOnline ? 'No catalogues available for your brands' : 'Go online to view catalogues'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {catalogues.map(catalogue => (
                <div
                  key={catalogue.id}
                  className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">📕</span>
                        <div>
                          <h3 className="font-medium text-gray-800">{catalogue.name}</h3>
                          <p className="text-xs text-gray-500">
                            {catalogue.description} • {catalogue.size_mb}MB
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadCatalogue(catalogue)}
                      className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition flex items-center gap-2"
                    >
                      <span>📄</span>
                      <span>View</span>
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Updated: {new Date(catalogue.updated).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* More Actions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">More</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onNavigate('orders')}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 transition active:scale-95 shadow-sm"
            >
              <span className="text-2xl">📋</span>
              <span className="font-medium text-gray-800">Recent Orders</span>
            </button>
            <button
              onClick={() => onNavigate('settings')}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 transition active:scale-95 shadow-sm"
            >
              <span className="text-2xl">⚙️</span>
              <span className="font-medium text-gray-800">Settings</span>
            </button>
          </div>
        </div>
        
        {/* Sync Status */}
        {syncStatus?.lastProductSync && (
          <div className="text-center text-xs text-gray-400 pt-2">
            Last synced: {new Date(syncStatus.lastProductSync).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}

function PageHeader({ title, onBack }) {
  const { agent, logout } = useAuth()
  const offline = useOffline()
  
  return (
    <div className="bg-plum-500 text-white safe-area-top">
      {!offline?.isOnline && (
        <div className="bg-orange-500 text-white text-center text-xs py-1 font-medium">
          📴 Offline Mode - Using cached data
        </div>
      )}
      <div className="px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <button
              onClick={onBack}
              className="text-peach-400 hover:text-white transition touch-target pr-4 text-2xl"
            >
              ←
            </button>
            <div>
              <h1 className="text-xl font-bold">{title}</h1>
              <p className="text-peach-300 text-sm">{agent?.name}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="text-peach-400 hover:text-white transition touch-target px-2"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductsTab() {
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [usingOffline, setUsingOffline] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [viewMode, setViewMode] = useState(() => {
    // Persist view preference
    return localStorage.getItem('productsViewMode') || 'grid'
  })
  const { cart, addToCart, updateQuantity } = useCart()
  const { agent } = useAuth()
  const { isOnline } = useOffline()
  const { addToast } = useToast()
  
  // Save view mode preference
  useEffect(() => {
    localStorage.setItem('productsViewMode', viewMode)
  }, [viewMode])
  
  // Get cart quantity for a product
  const getCartQty = (itemId) => {
    const item = cart.find(i => i.item_id === itemId)
    return item ? item.quantity : 0
  }
  
  // Add one pack unit
  const handleAdd = (e, product) => {
    e.stopPropagation()
    const packQty = product.pack_qty || 1
    addToCart(product, packQty)
    addToast(`+${packQty} ${product.name}`, 'success')
  }
  
  // Remove one pack unit
  const handleRemove = (e, product) => {
    e.stopPropagation()
    const packQty = product.pack_qty || 1
    const currentQty = getCartQty(product.item_id)
    const newQty = Math.max(0, currentQty - packQty)
    updateQuantity(product.item_id, newQty)
    if (newQty === 0) {
      addToast(`Removed ${product.name}`, 'info')
    } else {
      addToast(`-${packQty} ${product.name}`, 'info')
    }
  }
  
  const loadProducts = async (reset = false) => {
    setLoading(true)
    
    // Try online first, fall back to offline
    if (isOnline) {
      try {
        const currentPage = reset ? 1 : page
        const params = new URLSearchParams({ page: currentPage })
        if (search) params.append('search', search)
        if (selectedBrand) params.append('brand', selectedBrand)
        
        const data = await apiRequest(`/products?${params}`)
        
        setProducts(reset ? data.products : [...products, ...data.products])
        setHasMore(data.has_more)
        setUsingOffline(false)
        if (reset) setPage(1)
        setLoading(false)
        return
      } catch (err) {
        console.log('Online fetch failed, trying offline:', err)
      }
    }
    
    // Use offline data
    try {
      const offlineProducts = await offlineStore.getProducts({
        brand: selectedBrand,
        search: search
      })
      setProducts(offlineProducts)
      setHasMore(false)
      setUsingOffline(true)
    } catch (err) {
      console.error('Failed to load offline products:', err)
      setProducts([])
    }
    setLoading(false)
  }
  
  useEffect(() => {
    if (selectedBrand) {
      loadProducts(true)
    }
  }, [search, selectedBrand, isOnline])
  
  // Show brand selector first
  if (!selectedBrand) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 bg-gray-50 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Select a Brand</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-4">
            {agent?.brands?.map(brand => (
              <button
                key={brand}
                onClick={() => setSelectedBrand(brand)}
                className="bg-white border-2 border-gray-200 rounded-xl p-6 text-center hover:border-primary-500 hover:bg-primary-50 transition active:scale-95"
              >
                <span className="font-semibold text-gray-800">{brand}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gray-50 border-b space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedBrand(null)}
            className="text-primary-600 font-medium text-2xl"
          >
            ←
          </button>
          <span className="font-semibold text-gray-800">{selectedBrand}</span>
          {usingOffline && (
            <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
              Offline
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
          {/* View Mode Toggle */}
          <div className="flex bg-gray-200 rounded-xl p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'list' 
                  ? 'bg-white text-primary-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
              title="List View"
            >
              ☰
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                viewMode === 'grid' 
                  ? 'bg-white text-primary-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
              title="Grid View with Images"
            >
              ▦
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        {loading && products.length === 0 ? (
          <LoadingSpinner />
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-5xl mb-4">📦</span>
            <p className="text-center">No products found</p>
            {!isOnline && (
              <p className="text-sm text-orange-600 mt-2">Sync data in Settings for offline access</p>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View with Images */
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map(product => {
                const cartQty = getCartQty(product.item_id)
                const packQty = product.pack_qty || 1
                return (
                  <div
                    key={product.item_id}
                    className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-primary-400 hover:shadow-md transition"
                  >
                    {/* Product Image - clickable to open modal */}
                    <div 
                      onClick={() => setSelectedProduct(product)}
                      className="aspect-square bg-gray-100 cursor-pointer"
                    >
                      <OfflineImage
                        itemId={product.item_id}
                        imageUrl={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-contain"
                        fallbackIcon="📦"
                      />
                    </div>
                    
                    {/* Product Info */}
                    <div className="p-3">
                      <p className="text-xs text-gray-500 mb-1">{product.sku}</p>
                      <h3 
                        onClick={() => setSelectedProduct(product)}
                        className="font-medium text-gray-800 text-sm line-clamp-2 mb-2 cursor-pointer hover:text-primary-600"
                      >
                        {product.name}
                      </h3>
                      
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-primary-600">£{product.rate?.toFixed(2)}</span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          product.stock_on_hand > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {product.stock_on_hand > 0 ? product.stock_on_hand : 'Out'}
                        </span>
                      </div>
                      
                      {product.pack_qty && (
                        <p className="text-xs text-blue-600 mb-2">Pack of {product.pack_qty}</p>
                      )}
                      
                      {/* Add/Remove Controls */}
                      <div className="flex items-center justify-between bg-gray-50 rounded-lg p-1">
                        <button
                          onClick={(e) => handleRemove(e, product)}
                          disabled={cartQty === 0}
                          className={`w-10 h-10 rounded-lg font-bold text-xl flex items-center justify-center transition ${
                            cartQty > 0 
                              ? 'bg-red-100 text-red-600 hover:bg-red-200 active:scale-95' 
                              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          −
                        </button>
                        
                        <div className="text-center">
                          {cartQty > 0 ? (
                            <span className="font-bold text-primary-600">{cartQty}</span>
                          ) : (
                            <span className="text-gray-400 text-sm">0</span>
                          )}
                        </div>
                        
                        <button
                          onClick={(e) => handleAdd(e, product)}
                          className="w-10 h-10 rounded-lg font-bold text-xl bg-green-100 text-green-600 hover:bg-green-200 active:scale-95 transition flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            
            {selectedProduct && (
              <ProductDetailModal
                product={selectedProduct}
                onClose={() => setSelectedProduct(null)}
                onAddToCart={addToCart}
              />
            )}
          </>
        ) : (
          /* List View - Compact without images */
          <>
            <div className="space-y-2">
              {products.map(product => {
                const cartQty = getCartQty(product.item_id)
                const packQty = product.pack_qty || 1
                return (
                  <div
                    key={product.item_id}
                    className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3"
                  >
                    {/* Product Info - clickable */}
                    <div 
                      onClick={() => setSelectedProduct(product)}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs text-gray-500">{product.sku}</p>
                        {product.pack_qty && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                            ×{product.pack_qty}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          product.stock_on_hand > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {product.stock_on_hand > 0 ? product.stock_on_hand : 'Out'}
                        </span>
                      </div>
                      <h3 className="font-medium text-gray-800 text-sm truncate hover:text-primary-600">
                        {product.name}
                      </h3>
                      <span className="font-bold text-primary-600">£{product.rate?.toFixed(2)}</span>
                    </div>
                    
                    {/* Add/Remove Controls */}
                    <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1">
                      <button
                        onClick={(e) => handleRemove(e, product)}
                        disabled={cartQty === 0}
                        className={`w-9 h-9 rounded-lg font-bold text-lg flex items-center justify-center transition ${
                          cartQty > 0 
                            ? 'bg-red-100 text-red-600 hover:bg-red-200 active:scale-95' 
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        −
                      </button>
                      
                      <div className="w-10 text-center">
                        {cartQty > 0 ? (
                          <span className="font-bold text-primary-600">{cartQty}</span>
                        ) : (
                          <span className="text-gray-400 text-sm">0</span>
                        )}
                      </div>
                      
                      <button
                        onClick={(e) => handleAdd(e, product)}
                        className="w-9 h-9 rounded-lg font-bold text-lg bg-green-100 text-green-600 hover:bg-green-200 active:scale-95 transition flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            
            {selectedProduct && (
              <ProductDetailModal
                product={selectedProduct}
                onClose={() => setSelectedProduct(null)}
                onAddToCart={addToCart}
              />
            )}
          </>
        )}
        
        {hasMore && (
          <div className="mt-4 text-center">
            <button
              onClick={() => { setPage(p => p + 1); loadProducts() }}
              disabled={loading}
              className="bg-gray-100 text-gray-700 px-6 py-3 rounded-xl font-medium hover:bg-gray-200 transition"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CustomersTab() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [usingOffline, setUsingOffline] = useState(false)
  const { setCustomer, customer: selectedCustomer } = useCart()
  const { isOnline } = useOffline()
  
  const loadCustomers = async () => {
    setLoading(true)
    
    // Try online first
    if (isOnline) {
      try {
        const params = new URLSearchParams()
        if (search) params.append('search', search)
        const data = await apiRequest(`/customers?${params}`)
        setCustomers(data.customers)
        setUsingOffline(false)
        setLoading(false)
        return
      } catch (err) {
        console.log('Online fetch failed, trying offline:', err)
      }
    }
    
    // Use offline data
    try {
      const offlineCustomers = await offlineStore.getCustomers(search)
      setCustomers(offlineCustomers)
      setUsingOffline(true)
    } catch (err) {
      console.error('Failed to load offline customers:', err)
      setCustomers([])
    }
    setLoading(false)
  }
  
  useEffect(() => {
    loadCustomers()
  }, [search, isOnline])
  
  const handleSelectCustomer = (customer) => {
    setCustomer(customer)
  }
  
  if (showNewForm) {
    return <NewCustomerForm onBack={() => setShowNewForm(false)} onCreated={(c) => { setCustomer(c); setShowNewForm(false); loadCustomers() }} />
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gray-50 border-b space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers..."
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
          {usingOffline && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full whitespace-nowrap">
              Offline
            </span>
          )}
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          disabled={!isOnline}
          className="w-full bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700 disabled:bg-gray-400 transition"
        >
          {isOnline ? '+ New Customer' : 'Go online to add customers'}
        </button>
      </div>
      
      {selectedCustomer && (
        <div className="p-4 bg-primary-50 border-b border-primary-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-primary-600 font-medium">SELECTED CUSTOMER</p>
              <p className="font-bold text-gray-800">{selectedCustomer.company_name}</p>
            </div>
            <button
              onClick={() => setCustomer(null)}
              className="text-red-600 text-sm font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingSpinner />
        ) : (
          <div className="divide-y">
            {customers.map(customer => (
              <button
                key={customer.contact_id}
                onClick={() => handleSelectCustomer(customer)}
                className={`w-full p-4 text-left hover:bg-gray-50 transition ${
                  selectedCustomer?.contact_id === customer.contact_id ? 'bg-primary-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-800">{customer.company_name}</h3>
                    {customer.contact_name && customer.contact_name !== customer.company_name && (
                      <p className="text-sm text-gray-500">{customer.contact_name}</p>
                    )}
                    {customer.email && (
                      <p className="text-sm text-gray-400">{customer.email}</p>
                    )}
                  </div>
                  {selectedCustomer?.contact_id === customer.contact_id && (
                    <span className="text-primary-600 text-xl">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NewCustomerForm({ onBack, onCreated }) {
  const [form, setForm] = useState({ 
    company_name: '', 
    contact_name: '', 
    email: '', 
    phone: '',
    billing_address: '',
    shipping_address: '',
    booking_requirements: '',
    payment_terms: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.company_name) {
      setError('Company name is required')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      const data = await apiRequest('/customers', {
        method: 'POST',
        body: JSON.stringify(form)
      })
      onCreated(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gray-50 border-b flex items-center">
        <button onClick={onBack} className="text-primary-600 font-medium mr-4">← Back</button>
        <h2 className="font-bold text-lg">New Customer</h2>
      </div>
      
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Company Name *</label>
          <input
            type="text"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Contact Name</label>
          <input
            type="text"
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Billing Address</label>
          <textarea
            value={form.billing_address}
            onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            placeholder="Enter billing address..."
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Shipping Address</label>
          <textarea
            value={form.shipping_address}
            onChange={(e) => setForm({ ...form, shipping_address: e.target.value })}
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            placeholder="Enter shipping address..."
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Booking In Requirements</label>
          <textarea
            value={form.booking_requirements}
            onChange={(e) => setForm({ ...form, booking_requirements: e.target.value })}
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            placeholder="Any special booking requirements..."
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms</label>
          <textarea
            value={form.payment_terms}
            onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
            rows={2}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            placeholder="e.g. Net 30, Proforma, etc."
          />
        </div>
        
        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary-600 text-white py-4 rounded-xl font-semibold text-lg hover:bg-primary-700 disabled:opacity-50 transition"
        >
          {loading ? 'Creating...' : 'Create Customer'}
        </button>
      </form>
    </div>
  )
}

function CustomerSelectModal({ onSelect, onClose }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { isOnline } = useOffline()
  
  const loadCustomers = async () => {
    setLoading(true)
    
    if (isOnline) {
      try {
        const params = new URLSearchParams()
        if (search) params.append('search', search)
        const data = await apiRequest(`/customers?${params}`)
        setCustomers(data.customers)
        setLoading(false)
        return
      } catch (err) {
        console.log('Online fetch failed, trying offline:', err)
      }
    }
    
    try {
      const offlineCustomers = await offlineStore.getCustomers(search)
      setCustomers(offlineCustomers)
    } catch (err) {
      console.error('Failed to load offline customers:', err)
      setCustomers([])
    }
    setLoading(false)
  }
  
  useEffect(() => {
    loadCustomers()
  }, [search, isOnline])
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">Select Customer</h2>
          <button onClick={onClose} className="text-gray-500 text-2xl leading-none">&times;</button>
        </div>
        
        <div className="p-4 border-b">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers..."
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            autoFocus
          />
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <LoadingSpinner />
          ) : customers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No customers found</p>
            </div>
          ) : (
            <div className="divide-y">
              {customers.map(customer => (
                <button
                  key={customer.contact_id}
                  onClick={() => { onSelect(customer); onClose(); }}
                  className="w-full p-4 text-left hover:bg-gray-50 active:bg-gray-100 transition"
                >
                  <h3 className="font-medium text-gray-800">{customer.company_name}</h3>
                  {customer.contact_name && customer.contact_name !== customer.company_name && (
                    <p className="text-sm text-gray-500">{customer.contact_name}</p>
                  )}
                  {customer.email && (
                    <p className="text-sm text-gray-400">{customer.email}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Constants for freight
const FREIGHT_FREE_THRESHOLD = 250 // £250 ex VAT
const DELIVERY_CHARGE = 10 // £10 ex VAT

function CartTab({ onOrderSubmitted }) {
  const { cart, customer, setCustomer, cartTotal, updateQuantity, updateDiscount, clearCart } = useCart()
  const { isOnline, refreshSyncStatus } = useOffline()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [showCustomerSelect, setShowCustomerSelect] = useState(false)
  
  // Calculate if delivery charge applies
  const needsDeliveryCharge = cartTotal < FREIGHT_FREE_THRESHOLD
  const amountToFreeDelivery = FREIGHT_FREE_THRESHOLD - cartTotal
  const orderTotal = needsDeliveryCharge ? cartTotal + DELIVERY_CHARGE : cartTotal
  
  const handleExportQuote = async () => {
    if (cart.length === 0) {
      setError('Cart is empty')
      return
    }
    
    setExporting(true)
    setError('')
    
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/export/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          items: cart.map(item => ({
            item_id: item.item_id,
            name: item.name,
            sku: item.sku,
            ean: item.ean || '',
            rate: item.rate,
            quantity: item.quantity
          })),
          customer_name: customer?.company_name || null
        })
      })
      
      if (!response.ok) {
        throw new Error('Export failed')
      }
      
      // Download the file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1] || 'quote.xlsx'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }
  
  const handleSubmitOrder = async () => {
    if (!customer) {
      setError('Please select a customer first')
      return
    }
    
    if (cart.length === 0) {
      setError('Cart is empty')
      return
    }
    
    if (!deliveryDate) {
      setError('Please select a required delivery date')
      return
    }
    
    setLoading(true)
    setError('')
    
    const orderData = {
      customer_id: customer.contact_id,
      customer_name: customer.company_name,
      notes,
      delivery_date: deliveryDate,
      delivery_charge: needsDeliveryCharge ? DELIVERY_CHARGE : 0,
      line_items: cart.map(item => ({
        item_id: item.item_id,
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        rate: item.rate,
        discount_percent: item.discount
      }))
    }
    
    // If offline, save to pending queue
    if (!isOnline) {
      try {
        await offlineStore.savePendingOrder({ orderData })
        clearCart()
        setNotes('')
        setDeliveryDate('')
        addToast('Order saved! Will submit when back online.', 'success')
        // Refresh sync status to update pending count
        await refreshSyncStatus()
      } catch (err) {
        setError('Failed to save offline order')
      }
      setLoading(false)
      return
    }
    
    // Online - submit normally
    try {
      const result = await apiRequest('/orders', {
        method: 'POST',
        body: JSON.stringify(orderData)
      })
      
      clearCart()
      setNotes('')
      setDeliveryDate('')
      addToast(`Order ${result.salesorder_number} submitted successfully!`, 'success')
      onOrderSubmitted(result)
    } catch (err) {
      setError(err.message)
      addToast('Failed to submit order: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="flex flex-col h-full">
      {customer ? (
        <div className="p-4 bg-primary-50 border-b border-primary-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-primary-600 font-medium">ORDER FOR</p>
              <p className="font-bold text-gray-800">{customer.company_name}</p>
            </div>
            <button
              onClick={() => setShowCustomerSelect(true)}
              className="text-primary-600 text-sm font-medium px-3 py-1 border border-primary-300 rounded-lg hover:bg-primary-100 transition"
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-yellow-50 border-b border-yellow-200">
          <div className="flex items-center justify-between">
            <p className="text-yellow-800">No customer selected</p>
            <button
              onClick={() => setShowCustomerSelect(true)}
              className="bg-yellow-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-yellow-700 transition"
            >
              Select Customer
            </button>
          </div>
        </div>
      )}
      
      {showCustomerSelect && (
        <CustomerSelectModal
          onSelect={setCustomer}
          onClose={() => setShowCustomerSelect(false)}
        />
      )}
      
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-5xl mb-4">🛒</span>
            <p>Your cart is empty</p>
          </div>
        ) : (
          <div className="divide-y">
            {cart.map(item => (
              <div key={item.item_id} className="p-4">
                <div className="flex gap-3 mb-2">
                  <div className="w-16 h-16 rounded-lg flex-shrink-0 overflow-hidden">
                    <OfflineImage
                      itemId={item.item_id}
                      imageUrl={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      fallbackIcon="📦"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0 pr-2">
                        <h3 className="font-medium text-gray-800 truncate">{item.name}</h3>
                        <p className="text-sm text-gray-500">{item.sku}</p>
                        <p className="text-primary-600 font-medium">£{item.rate?.toFixed(2)} each</p>
                      </div>
                      <button
                        onClick={() => updateQuantity(item.item_id, 0)}
                        className="text-red-500 text-sm flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center">
                    <label className="text-sm text-gray-600 mr-2">Qty:</label>
                    <button
                      onClick={() => updateQuantity(item.item_id, Math.max(0, item.quantity - (item.pack_qty || 1)))}
                      className="w-8 h-8 bg-red-100 text-red-600 rounded-lg font-bold hover:bg-red-200 active:scale-95 transition"
                    >
                      −
                    </button>
                    <span className="w-12 text-center font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.item_id, item.quantity + (item.pack_qty || 1))}
                      className="w-8 h-8 bg-green-100 text-green-600 rounded-lg font-bold hover:bg-green-200 active:scale-95 transition"
                    >
                      +
                    </button>
                    {item.pack_qty > 1 && (
                      <span className="text-xs text-blue-600 ml-2">×{item.pack_qty}</span>
                    )}
                  </div>
                  
                  <div className="flex items-center">
                    <label className="text-sm text-gray-600 mr-2">Discount:</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={item.discount}
                      onChange={(e) => updateDiscount(item.item_id, parseFloat(e.target.value) || 0)}
                      className="w-16 px-2 py-1 border rounded text-center"
                    />
                    <span className="ml-1 text-gray-600">%</span>
                  </div>
                  
                  <div className="text-right flex-1">
                    <p className="font-bold">
                      £{((item.rate * item.quantity) * (1 - item.discount / 100)).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {cart.length > 0 && (
        <div className="border-t bg-white p-4 space-y-4 safe-area-bottom">
          {/* Free Delivery Progress Banner */}
          {needsDeliveryCharge ? (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-orange-800 font-medium text-sm">🚚 Delivery Charge: £{DELIVERY_CHARGE.toFixed(2)}</span>
                <span className="text-orange-600 text-sm">£{amountToFreeDelivery.toFixed(2)} to FREE delivery</span>
              </div>
              <div className="w-full bg-orange-200 rounded-full h-2">
                <div 
                  className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((cartTotal / FREIGHT_FREE_THRESHOLD) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-orange-600 mt-1">Orders over £250 qualify for free delivery</p>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-xl">✅</span>
                <span className="text-green-800 font-medium">FREE Delivery - Order qualifies!</span>
              </div>
            </div>
          )}
          
          {/* Required Delivery Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Required Delivery Date *</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            />
          </div>
          
          {/* Order Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Order Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="Add any notes for this order..."
            />
          </div>
          
          {/* Order Summary */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">£{cartTotal.toFixed(2)}</span>
            </div>
            {needsDeliveryCharge && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Delivery:</span>
                <span className="font-medium text-orange-600">£{DELIVERY_CHARGE.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-lg pt-2 border-t border-gray-200">
              <span className="font-semibold">Total (ex VAT):</span>
              <span className="font-bold text-primary-600">£{orderTotal.toFixed(2)}</span>
            </div>
          </div>
          
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={handleExportQuote}
              disabled={exporting}
              className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-semibold text-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {exporting ? 'Exporting...' : '📄 Export Quote'}
            </button>
            <button
              onClick={handleSubmitOrder}
              disabled={loading || !customer || !deliveryDate}
              className={`flex-1 text-white py-4 rounded-xl font-semibold text-lg disabled:opacity-50 transition ${
                isOnline ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {loading ? 'Saving...' : isOnline ? 'Submit Order' : '📴 Save Offline'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function OrdersTab() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  
  const loadOrders = async () => {
    setLoading(true)
    try {
      const data = await apiRequest('/orders')
      setOrders(data.orders)
    } catch (err) {
      console.error('Failed to load orders:', err)
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    loadOrders()
  }, [])
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gray-50 border-b">
        <button
          onClick={loadOrders}
          className="w-full bg-gray-200 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-300 transition"
        >
          Refresh Orders
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingSpinner />
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-5xl mb-4">📋</span>
            <p>No orders yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {orders.map(order => (
              <div key={order.salesorder_id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-primary-600">{order.salesorder_number}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    order.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                    order.status === 'draft' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-gray-800">{order.customer_name}</p>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="text-gray-500">{order.date}</span>
                  <span className="font-medium">£{order.total?.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function QuickOrderTab() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const { addToCart } = useCart()
  const { isOnline } = useOffline()
  
  const handleLookup = async () => {
    if (!input.trim()) return
    
    setLoading(true)
    setResults([])
    
    // Parse input - each line can be "SKU" or "SKU qty" or "SKU,qty"
    const lines = input.split('\n').filter(line => line.trim())
    const lookupResults = []
    
    for (const line of lines) {
      // Parse SKU/EAN and optional quantity
      const parts = line.trim().split(/[,\s]+/)
      const code = parts[0].toUpperCase()
      const qty = parseInt(parts[1]) || 1
      
      // Try online first
      if (isOnline) {
        try {
          const barcodeData = await apiRequest(`/barcode/${encodeURIComponent(code)}`)
          
          if (barcodeData.found && barcodeData.product) {
            lookupResults.push({
              sku: code,
              qty,
              found: true,
              product: barcodeData.product
            })
            continue
          }
          
          // Fall back to SKU search
          const data = await apiRequest(`/products?search=${encodeURIComponent(code)}`)
          const products = data.products || []
          const exactMatch = products.find(p => p.sku?.toUpperCase() === code)
          
          if (exactMatch) {
            lookupResults.push({ sku: code, qty, found: true, product: exactMatch })
            continue
          } else if (products.length > 0) {
            lookupResults.push({ sku: code, qty, found: true, product: products[0], partial: true })
            continue
          }
        } catch (err) {
          console.log('Online lookup failed for', code)
        }
      }
      
      // Try offline lookup
      try {
        let product = await offlineStore.getProductByEAN(code)
        if (!product) {
          product = await offlineStore.getProductBySKU(code)
        }
        if (!product) {
          // Search by name/sku in offline store
          const offlineProducts = await offlineStore.getProducts({ search: code })
          if (offlineProducts.length > 0) {
            product = offlineProducts[0]
          }
        }
        
        if (product) {
          lookupResults.push({ sku: code, qty, found: true, product })
          continue
        }
      } catch (err) {
        console.error('Offline lookup failed:', err)
      }
      
      // Not found
      lookupResults.push({ sku: code, qty, found: false })
    }
    
    setResults(lookupResults)
    setLoading(false)
  }
  
  const handleAddAll = () => {
    const foundItems = results.filter(r => r.found)
    foundItems.forEach(r => {
      addToCart(r.product, r.qty)
    })
    // Clear after adding
    setInput('')
    setResults([])
  }
  
  const handleAddSingle = (result) => {
    addToCart(result.product, result.qty)
    // Remove from results
    setResults(prev => prev.filter(r => r.sku !== result.sku))
  }
  
  const foundCount = results.filter(r => r.found).length
  const notFoundCount = results.filter(r => !r.found).length
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-gray-50 border-b space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enter SKU or EAN codes (one per line, optionally with quantity)
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"GL10\nCM18 6\nEM20,12\nPB15 4"}
            rows={5}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none font-mono text-sm"
          />
        </div>
        <button
          onClick={handleLookup}
          disabled={loading || !input.trim()}
          className="w-full bg-primary-600 text-white py-3 rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50 transition"
        >
          {loading ? 'Looking up...' : 'Look Up Products'}
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        {results.length > 0 && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm">
                <span className="text-green-600 font-medium">{foundCount} found</span>
                {notFoundCount > 0 && (
                  <span className="text-red-600 font-medium ml-3">{notFoundCount} not found</span>
                )}
              </div>
              {foundCount > 0 && (
                <button
                  onClick={handleAddAll}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition"
                >
                  Add All ({foundCount}) to Cart
                </button>
              )}
            </div>
            
            <div className="space-y-3">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border ${
                    result.found
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold">{result.sku}</span>
                        <span className="text-gray-500">× {result.qty}</span>
                        {result.partial && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">partial match</span>
                        )}
                      </div>
                      {result.found ? (
                        <div className="mt-1">
                          <p className="text-sm text-gray-800">{result.product.name}</p>
                          <p className="text-sm text-primary-600 font-medium">£{result.product.rate?.toFixed(2)} each</p>
                          <p className="text-xs text-gray-500">
                            {result.product.stock_on_hand > 0 
                              ? `${result.product.stock_on_hand} in stock` 
                              : 'Out of stock'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-red-600 mt-1">Product not found</p>
                      )}
                    </div>
                    {result.found && (
                      <button
                        onClick={() => handleAddSingle(result)}
                        className="bg-green-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-green-700 transition"
                      >
                        Add
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        
        {results.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-5xl mb-4">⚡</span>
            <p className="text-center">Enter SKU or EAN codes above to quickly add products to your cart</p>
            <p className="text-sm text-gray-400 mt-2">Format: CODE or CODE quantity</p>
          </div>
        )}
      </div>
    </div>
  )
}

function OrderSuccessModal({ order, onClose }) {
  const [downloading, setDownloading] = useState(false)
  
  const handleDownloadPDF = async () => {
    setDownloading(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_BASE}/orders/${order.salesorder_id}/pdf`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      
      if (!response.ok) {
        throw new Error('Failed to generate PDF')
      }
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${order.salesorder_number}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (err) {
      console.error('PDF download failed:', err)
      alert('Failed to download PDF: ' + err.message)
    } finally {
      setDownloading(false)
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center">
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Order Submitted!</h2>
        <p className="text-gray-600 mb-4">Order Number: <strong>{order.salesorder_number}</strong></p>
        <p className="text-2xl font-bold text-primary-600 mb-6">£{order.total?.toFixed(2)}</p>
        <div className="space-y-3">
          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {downloading ? 'Generating PDF...' : '📄 Download Order PDF'}
          </button>
          <button
            onClick={onClose}
            className="w-full bg-primary-600 text-white py-4 rounded-xl font-semibold hover:bg-primary-700 transition"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

// Admin Panel (only for admins)
function AdminTab() {
  const [agents, setAgents] = useState([])
  const [availableBrands, setAvailableBrands] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingAgent, setEditingAgent] = useState(null)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const { addToast } = useToast()
  
  const loadData = async () => {
    try {
      setLoading(true)
      const [agentsData, statsData] = await Promise.all([
        apiRequest('/admin/agents'),
        apiRequest('/admin/stats')
      ])
      setAgents(agentsData.agents || [])
      setAvailableBrands(agentsData.available_brands || [])
      setStats(statsData)
    } catch (err) {
      addToast('Failed to load admin data: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    loadData()
  }, [])
  
  const handleUpdateAgent = async (agentId, updates) => {
    try {
      await apiRequest(`/admin/agents/${agentId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
      })
      addToast('Agent updated', 'success')
      setEditingAgent(null)
      loadData()
    } catch (err) {
      addToast('Failed to update: ' + err.message, 'error')
    }
  }
  
  const handleCreateAgent = async (agentData) => {
    try {
      await apiRequest('/admin/agents', {
        method: 'POST',
        body: JSON.stringify(agentData)
      })
      addToast('Agent created', 'success')
      setShowNewAgent(false)
      loadData()
    } catch (err) {
      addToast('Failed to create: ' + err.message, 'error')
    }
  }
  
  const handleDeleteAgent = async (agentId) => {
    if (!confirm('Are you sure you want to delete this agent?')) return
    try {
      await apiRequest(`/admin/agents/${agentId}`, { method: 'DELETE' })
      addToast('Agent deleted', 'success')
      loadData()
    } catch (err) {
      addToast('Failed to delete: ' + err.message, 'error')
    }
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-600 border-t-transparent"></div>
      </div>
    )
  }
  
  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-primary-600">{stats.active_agents}</div>
            <div className="text-sm text-gray-500">Active Agents</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-green-600">{stats.orders_today}</div>
            <div className="text-sm text-gray-500">Orders Today</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-blue-600">£{stats.orders_today_value?.toFixed(0) || 0}</div>
            <div className="text-sm text-gray-500">Today's Value</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-600">{stats.recent_orders}</div>
            <div className="text-sm text-gray-500">Recent Orders</div>
          </div>
        </div>
      )}
      
      {/* Orders by Agent */}
      {stats?.orders_by_agent && Object.keys(stats.orders_by_agent).length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <h3 className="font-semibold mb-3">Recent Orders by Agent</h3>
          <div className="space-y-2">
            {Object.entries(stats.orders_by_agent).map(([name, count]) => (
              <div key={name} className="flex justify-between text-sm">
                <span>{name}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Agents List */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="font-semibold text-lg">Agents</h3>
          <button
            onClick={() => setShowNewAgent(true)}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Agent
          </button>
        </div>
        
        <div className="divide-y divide-gray-100">
          {agents.map(agent => (
            <div key={agent.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{agent.name}</span>
                    {agent.is_admin && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Admin</span>
                    )}
                    {!agent.active && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Inactive</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">@{agent.id}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {agent.brands?.length === 8 ? 'All brands' : agent.brands?.join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => setEditingAgent(agent)}
                  className="text-primary-600 text-sm font-medium"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Edit Agent Modal */}
      {editingAgent && (
        <AgentEditModal
          agent={editingAgent}
          availableBrands={availableBrands}
          onSave={(updates) => handleUpdateAgent(editingAgent.id, updates)}
          onDelete={() => handleDeleteAgent(editingAgent.id)}
          onClose={() => setEditingAgent(null)}
        />
      )}
      
      {/* New Agent Modal */}
      {showNewAgent && (
        <NewAgentModal
          availableBrands={availableBrands}
          onSave={handleCreateAgent}
          onClose={() => setShowNewAgent(false)}
        />
      )}
    </div>
  )
}

function AgentEditModal({ agent, availableBrands, onSave, onDelete, onClose }) {
  const [name, setName] = useState(agent.name)
  const [pin, setPin] = useState('')
  const [brands, setBrands] = useState(agent.brands || [])
  const [active, setActive] = useState(agent.active !== false)
  const [commission, setCommission] = useState((agent.commission_rate || 0.125) * 100)
  
  const handleSave = () => {
    const updates = { name, brands, active, commission_rate: commission / 100 }
    if (pin) updates.pin = pin
    onSave(updates)
  }
  
  const toggleBrand = (brand) => {
    setBrands(prev => 
      prev.includes(brand) 
        ? prev.filter(b => b !== brand)
        : [...prev, brand]
    )
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">Edit Agent</h2>
          <button onClick={onClose} className="text-gray-500 text-2xl">&times;</button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={agent.id}
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New PIN (leave blank to keep)</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commission Rate (%)</label>
            <input
              type="number"
              value={commission}
              onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
              step="0.5"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Brands</label>
            <div className="flex flex-wrap gap-2">
              {availableBrands.map(brand => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => toggleBrand(brand)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                    brands.includes(brand)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Active</span>
            <button
              type="button"
              onClick={() => setActive(!active)}
              className={`w-12 h-6 rounded-full transition ${active ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full shadow transform transition ${active ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-200 space-y-2">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold"
          >
            Save Changes
          </button>
          {!agent.is_admin && (
            <button
              onClick={onDelete}
              className="w-full py-3 bg-red-100 text-red-600 rounded-xl font-semibold"
            >
              Delete Agent
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function NewAgentModal({ availableBrands, onSave, onClose }) {
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [brands, setBrands] = useState([])
  const [commission, setCommission] = useState(12.5)
  
  const handleSave = () => {
    if (!username || !name || !pin) {
      alert('Please fill in username, name and PIN')
      return
    }
    onSave({
      agent_id: username.toLowerCase().replace(/\s+/g, '.'),
      name,
      pin,
      brands,
      commission_rate: commission / 100
    })
  }
  
  const toggleBrand = (brand) => {
    setBrands(prev => 
      prev.includes(brand) 
        ? prev.filter(b => b !== brand)
        : [...prev, brand]
    )
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">New Agent</h2>
          <button onClick={onClose} className="text-gray-500 text-2xl">&times;</button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. john.smith"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PIN *</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4 digits"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commission Rate (%)</label>
            <input
              type="number"
              value={commission}
              onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
              step="0.5"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Brands</label>
            <div className="flex flex-wrap gap-2">
              {availableBrands.map(brand => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => toggleBrand(brand)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                    brands.includes(brand)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold"
          >
            Create Agent
          </button>
        </div>
      </div>
    </div>
  )
}

// Settings Tab with Sync Controls
function SettingsTab() {
  const { agent, logout } = useAuth()
  const { isOnline, syncStatus, isSyncing, doSync, submitPendingOrders, refreshSyncStatus } = useOffline()
  const { addToast } = useToast()
  const [syncProgress, setSyncProgress] = useState('')
  const [isDownloadingImages, setIsDownloadingImages] = useState(false)
  const [debugInfo, setDebugInfo] = useState(null)
  const [showDebug, setShowDebug] = useState(false)
  
  // Debug function to check what's happening
  const runDebug = async () => {
    const info = {
      isNativeApp: window.Capacitor?.isNativePlatform?.() || false,
      capacitorAvailable: !!window.Capacitor,
      apiBase: isNativeApp ? 'https://appdmbrands.com/api' : '/api',
      navigator_onLine: navigator.onLine,
      token: localStorage.getItem('token') ? 'present' : 'missing',
    }
    
    // Check IndexedDB image count
    try {
      const count = await offlineStore.getImageCount()
      info.indexedDBImageCount = count
    } catch (err) {
      info.indexedDBImageCount = 'error: ' + err.message
    }
    
    // Try to get first few image IDs
    try {
      const ids = await offlineStore.listImageIds()
      info.sampleImageIds = ids.slice(0, 5)
    } catch (err) {
      info.sampleImageIds = 'error: ' + err.message
    }
    
    // Test fetch a single image
    try {
      const products = await offlineStore.getProducts()
      if (products.length > 0) {
        const testProduct = products[0]
        info.testProductId = testProduct.item_id
        
        // Try fetching image
        const token = localStorage.getItem('token')
        const testUrl = `${info.apiBase}/products/${testProduct.item_id}/image`
        info.testImageUrl = testUrl
        
        const response = await fetch(testUrl, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
        info.testFetchStatus = response.status
        info.testFetchOk = response.ok
        
        if (response.ok) {
          const blob = await response.blob()
          info.testBlobSize = blob.size
          info.testBlobType = blob.type
        }
      } else {
        info.testProductId = 'no products synced'
      }
    } catch (err) {
      info.testFetchError = err.message
    }
    
    setDebugInfo(info)
  }
  
  const handleSync = async () => {
    if (!isOnline) {
      addToast('Cannot sync while offline', 'error')
      return
    }
    
    try {
      await doSync((progress) => {
        setSyncProgress(progress.message || '')
      })
      setSyncProgress('')
      addToast('Sync complete!', 'success')
    } catch (err) {
      setSyncProgress('')
      addToast('Sync failed: ' + err.message, 'error')
    }
  }
  
  const handleDownloadImages = async () => {
    if (!isOnline) {
      addToast('Cannot download images while offline', 'error')
      return
    }
    
    setIsDownloadingImages(true)
    try {
      // Get products from cache
      const products = await offlineStore.getProducts()
      if (products.length === 0) {
        addToast('Sync products first', 'error')
        setIsDownloadingImages(false)
        return
      }
      
      // Download images (uses API but saves to IndexedDB for future offline use)
      const count = await syncService.syncImages(products, (progress) => {
        setSyncProgress(progress.message || '')
      })
      setSyncProgress('')
      await refreshSyncStatus()
      addToast(`Downloaded ${count} images for offline use`, 'success')
    } catch (err) {
      setSyncProgress('')
      addToast('Image download failed: ' + err.message, 'error')
    } finally {
      setIsDownloadingImages(false)
    }
  }
  
  const handleSubmitPending = async () => {
    if (!isOnline) {
      addToast('Cannot submit orders while offline', 'error')
      return
    }
    
    try {
      const result = await submitPendingOrders()
      if (result.submitted > 0) {
        addToast(`Submitted ${result.submitted} orders`, 'success')
      }
      if (result.failed > 0) {
        addToast(`${result.failed} orders failed`, 'error')
      }
    } catch (err) {
      addToast('Failed to submit orders', 'error')
    }
  }
  
  const formatDate = (isoString) => {
    if (!isoString) return 'Never'
    const date = new Date(isoString)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
  }
  
  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Connection Status */}
      <div className={`p-4 rounded-lg ${isOnline ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-semibold">{isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <p className="text-sm mt-1 text-gray-600">
          {isOnline ? 'Connected to server' : 'Working with local data'}
        </p>
      </div>
      
      {/* Sync Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-lg mb-3">🔄 Offline Data</h3>
        
        {syncStatus && (
          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-gray-600">Products cached:</span>
              <span className="font-medium">{syncStatus.productCount || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Images cached:</span>
              <span className="font-medium">{syncStatus.imageCount || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Customers cached:</span>
              <span className="font-medium">{syncStatus.customerCount || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Last sync:</span>
              <span className="font-medium">{formatDate(syncStatus.lastProductSync)}</span>
            </div>
          </div>
        )}
        
        <button
          onClick={handleSync}
          disabled={isSyncing || isDownloadingImages || !isOnline}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold disabled:bg-gray-400"
        >
          {isSyncing ? syncProgress || 'Syncing...' : '📲 Sync Products & Customers'}
        </button>
        <p className="text-xs text-gray-500 mt-2 text-center">
          Downloads product data and customers for offline browsing
        </p>
        
        <button
          onClick={handleDownloadImages}
          disabled={isSyncing || isDownloadingImages || !isOnline}
          className="w-full mt-3 py-3 bg-purple-600 text-white rounded-lg font-semibold disabled:bg-gray-400"
        >
          {isDownloadingImages ? syncProgress || 'Downloading...' : '🖼️ Pre-Download All Images'}
        </button>
        <p className="text-xs text-gray-500 mt-2 text-center">
          Optional: Images load automatically when viewing products.
          Use this to download all images at once for faster browsing.
        </p>
      </div>
      
      {/* Pending Orders */}
      {syncStatus?.pendingOrderCount > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h3 className="font-semibold text-lg mb-2">⏳ Pending Orders</h3>
          <p className="text-sm text-gray-600 mb-3">
            You have {syncStatus.pendingOrderCount} order(s) waiting to be submitted.
          </p>
          <button
            onClick={handleSubmitPending}
            disabled={!isOnline}
            className="w-full py-3 bg-orange-500 text-white rounded-lg font-semibold disabled:bg-gray-400"
          >
            {isOnline ? 'Submit Pending Orders' : 'Go online to submit'}
          </button>
        </div>
      )}
      
      {/* Agent Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-lg mb-3">👤 Account</h3>
        <div className="text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Agent:</span>
            <span className="font-medium">{agent?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Brands:</span>
            <span className="font-medium text-right">{agent?.brands?.join(', ')}</span>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full mt-4 py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold"
        >
          Log Out
        </button>
      </div>
      
      {/* Debug Section */}
      <div className="bg-gray-100 rounded-lg border border-gray-300 p-4">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="w-full text-left font-semibold text-gray-700 flex justify-between items-center"
        >
          <span>🔧 Debug Info</span>
          <span>{showDebug ? '▲' : '▼'}</span>
        </button>
        
        {showDebug && (
          <div className="mt-3 space-y-3">
            <button
              onClick={runDebug}
              className="w-full py-2 bg-gray-600 text-white rounded-lg text-sm"
            >
              Run Diagnostics
            </button>
            
            {debugInfo && (
              <div className="bg-white rounded-lg p-3 text-xs font-mono overflow-auto max-h-64">
                <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
              </div>
            )}
            
            <div className="text-xs text-gray-600 space-y-1">
              <p><strong>Native App:</strong> {String(window.Capacitor?.isNativePlatform?.() || false)}</p>
              <p><strong>Capacitor:</strong> {window.Capacitor ? 'Available' : 'Not Available'}</p>
              <p><strong>API Base:</strong> {isNativeApp ? 'https://appdmbrands.com/api' : '/api'}</p>
            </div>
          </div>
        )}
      </div>
      
      {/* App Info */}
      <div className="text-center text-xs text-gray-400 py-4">
        DMB Sales App v1.0
      </div>
    </div>
  )
}

function TabBar({ activeTab, setActiveTab }) {
  const { cartCount, cartTotal } = useCart()
  const { isAdmin } = useAuth()
  const offline = useOffline()
  
  const tabs = [
    { id: 'home', label: 'Home', icon: '🏠' },
    { id: 'products', label: 'Products', icon: '📦' },
    { id: 'customers', label: 'Customers', icon: '👥' },
    { id: 'cart', label: cartCount > 0 ? `£${cartTotal.toFixed(0)}` : 'Cart', icon: '🛒', badge: cartCount },
    { id: 'settings', label: 'Settings', icon: '⚙️', badge: offline?.syncStatus?.pendingOrderCount || 0 }
  ]
  
  // Add admin tab for admins
  if (isAdmin) {
    tabs.splice(4, 0, { id: 'admin', label: 'Admin', icon: '👑' })
  }
  
  return (
    <div className="bg-white border-t border-gray-200 safe-area-bottom">
      <div className="flex">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 flex flex-col items-center relative touch-target ${
              activeTab === tab.id ? 'text-primary-600' : 'text-gray-500'
            }`}
          >
            <span className="text-2xl">{tab.icon}</span>
            <span className="text-xs mt-1 font-medium">{tab.label}</span>
            {tab.badge > 0 && (
              <span className="absolute top-1 right-1/4 bg-red-500 text-white text-xs min-w-5 h-5 px-1 rounded-full flex items-center justify-center font-bold">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function BarcodeHandler({ children }) {
  const { addToCart } = useCart()
  const { addToast } = useToast()
  const { isOnline } = useOffline()
  
  const handleBarcodeScan = useCallback(async (barcode) => {
    addToast(`Scanning: ${barcode}...`, 'info')
    
    // Try online first
    if (isOnline) {
      try {
        const data = await apiRequest(`/barcode/${encodeURIComponent(barcode)}`)
        
        if (data.found && data.product) {
          addToCart(data.product, data.product.pack_qty || 1)
          addToast(`Added: ${data.product.name} (${data.product.pack_qty || 1})`, 'success')
          return
        }
      } catch (err) {
        console.log('Online barcode lookup failed, trying offline')
      }
    }
    
    // Try offline lookup
    try {
      // First try EAN
      let product = await offlineStore.getProductByEAN(barcode)
      
      // Then try SKU
      if (!product) {
        product = await offlineStore.getProductBySKU(barcode)
      }
      
      if (product) {
        addToCart(product, product.pack_qty || 1)
        addToast(`Added: ${product.name} (${product.pack_qty || 1})`, 'success')
        return
      }
    } catch (err) {
      console.error('Offline lookup failed:', err)
    }
    
    addToast(`Not found: ${barcode}`, 'error')
  }, [addToCart, addToast, isOnline])
  
  useBarcodeScanner(handleBarcodeScan)
  
  return children
}

function MainApp() {
  const [activeSection, setActiveSection] = useState('home')
  const [successOrder, setSuccessOrder] = useState(null)
  
  const handleOrderSubmitted = (order) => {
    setSuccessOrder(order)
    setActiveSection('orders')
  }
  
  const titles = {
    products: 'Products',
    quickorder: 'Quick Order',
    customers: 'Customers',
    cart: 'Cart',
    orders: 'Recent Orders',
    settings: 'Settings',
    admin: 'Admin Panel'
  }
  
  // Show landing page if home selected
  if (activeSection === 'home') {
    return (
      <div className="h-full flex flex-col">
        <HomePage onNavigate={setActiveSection} />
        <TabBar activeTab={activeSection} setActiveTab={setActiveSection} />
      </div>
    )
  }
  
  return (
    <div className="h-full flex flex-col bg-gray-100">
      <PageHeader title={titles[activeSection]} onBack={() => setActiveSection('home')} />
      
      <div className="flex-1 overflow-hidden">
        {activeSection === 'products' && <ProductsTab />}
        {activeSection === 'quickorder' && <QuickOrderTab />}
        {activeSection === 'customers' && <CustomersTab />}
        {activeSection === 'cart' && <CartTab onOrderSubmitted={handleOrderSubmitted} />}
        {activeSection === 'orders' && <OrdersTab />}
        {activeSection === 'settings' && <SettingsTab />}
        {activeSection === 'admin' && <AdminTab />}
      </div>
      
      <TabBar activeTab={activeSection} setActiveTab={setActiveSection} />
      
      {successOrder && (
        <OrderSuccessModal
          order={successOrder}
          onClose={() => setSuccessOrder(null)}
        />
      )}
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { agent } = useAuth()
  
  if (!agent) {
    return <Navigate to="/login" replace />
  }
  
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <ToastProvider>
          <OfflineProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <BarcodeHandler>
                      <MainApp />
                    </BarcodeHandler>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </OfflineProvider>
        </ToastProvider>
      </CartProvider>
    </AuthProvider>
  )
}
