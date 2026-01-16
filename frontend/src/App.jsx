import React, { useState, useEffect, createContext, useContext, useCallback, useRef, useMemo } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import * as offlineStore from './offlineStore'
import * as syncService from './syncService'

// Wake Lock helper to prevent screen sleep during long operations
// Uses Wake Lock API with fallback to video trick for iOS
const useWakeLock = () => {
  const wakeLockRef = useRef(null)
  const videoRef = useRef(null)
  
  const requestWakeLock = async () => {
    // Try native Wake Lock API first (Chrome, Edge, etc.)
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        console.log('Wake lock acquired via API')
        return
      } catch (err) {
        console.log('Wake Lock API failed:', err.message)
      }
    }
    
    // Fallback: Create a tiny looping video to keep screen awake (works on iOS)
    try {
      if (!videoRef.current) {
        const video = document.createElement('video')
        video.setAttribute('playsinline', '')
        video.setAttribute('muted', '')
        video.setAttribute('loop', '')
        video.style.position = 'fixed'
        video.style.top = '-1px'
        video.style.left = '-1px'
        video.style.width = '1px'
        video.style.height = '1px'
        video.style.opacity = '0.01'
        
        // Tiny base64 encoded silent video (1 second)
        video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA4BtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTMgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAwZYiEAD//8m+P5OXfBeLGOfKE3xkODvFZuBflHv/+VwJIta6cbpIo8u8pKxg0Ng5aAAAAEGQAB4AAAAALAAB+QAADaQAAAAwBTgMaAAWAAA8QAAADIAAB+gAAAAwBQBMF4AAHiBQAAACAgAH5AAAD6AAAAAHAKAJgvAAA8QAAAAEAB+QAABtAAAAB4CgCYLwAAPEAAAABAAf4AAACgAAAACAVATBeAAB4gAAAAQAH6AAAA+gAAAAQCoAmC8AADxAAAAAQAH+AAAA4AAAAA8BQBMFoAAHiAAAABAAfoAAAPoAAAAEAqAJgvAAA8QAAAAEAB/gAAAOAAAAAPAUATBaAAB4gAAAAQAH6AAAD6AAAABAKgCYLwAAPEAAAABAAfwAAAEAAAAABwCgCYLQAAPEAAAABAAfQAAACAAAAAHAKAJgtAAA8QAAAAEAB9AAAAIAAAAAcAoAmC0AADxAAAAAQAH0AAABAAAAADgFAEwWgAAeIAAAAEAB9AAAAQAAAAAwBQBMFoAAeIAAAACAA/QAAAEAAAAAOAUATBaAAB4gAAAAIAD9AAAAQAAAAAwBQBMF4AAHiAAAAAQAH0AAABAAAAADgFAEwXgAAeIAAAABAAfQAAAEAAAAAOAUATBeAAB4gAAAAEAB9AAAAQAAAAAwBQBMFoAAHiAAAAAQAH6AAAAgAAAABwCgCYLwAAPEAAAABAAfQAAACAAAAAHAKAJgvAAA8QAAAAEAB9AAAAIAAAAAYAoAmC8AADxAAAAAQAH0AAABAAAAADgFAEwXgAAeIAAAABAAfQAAAEAAAAAOAUATBeAAB4gAAAAEAB9AAAAYAAAAAMATBeAAAAAAAAAAAAAAA='
        
        document.body.appendChild(video)
        videoRef.current = video
      }
      
      videoRef.current.play().catch(() => {})
      console.log('Wake lock acquired via video fallback')
    } catch (err) {
      console.log('Video fallback failed:', err)
    }
  }
  
  const releaseWakeLock = () => {
    // Release Wake Lock API
    if (wakeLockRef.current) {
      wakeLockRef.current.release()
      wakeLockRef.current = null
      console.log('Wake lock released via API')
    }
    
    // Stop and remove video
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.remove()
      videoRef.current = null
      console.log('Wake lock released via video')
    }
  }
  
  return { requestWakeLock, releaseWakeLock }
}

// Debounce hook for search inputs
function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    
    return () => clearTimeout(handler)
  }, [value, delay])
  
  return debouncedValue
}

// API helpers
// In native app, use the deployed backend URL. In browser, use relative path (proxied in dev)
const isNativeApp = window.Capacitor?.isNativePlatform?.() || false
const API_BASE = isNativeApp ? 'https://appdmbrands.com/api' : '/api'

// Self-hosted CDN image helper
const CDN_BASE = 'https://cdn.appdmbrands.com'

// Convert SKU to CDN format (dots -> underscores for My Flame products)
// This matches how images are stored on the CDN from the Cloudinary backup
const skuToCdnId = (sku) => {
  if (!sku) return null
  return sku.replace(/\./g, '_')
}

// Keep old name as alias for backward compatibility
const skuToCloudinaryId = skuToCdnId

// Get image URL from self-hosted CDN
// Size parameter kept for API compatibility but not used (CDN serves full images)
// extension parameter allows trying different formats (jpg vs png)
const getImageUrl = (sku, size = 'medium', extension = 'jpg') => {
  if (!sku) return null
  const cdnSku = skuToCdnId(sku)
  return `${CDN_BASE}/products/${cdnSku}.${extension}`
}

// ProductImage component that uses IndexedDB cache first, then CDN as fallback
const ProductImage = ({ sku, alt, className, style, onClick }) => {
  const [imageSrc, setImageSrc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [triedPng, setTriedPng] = useState(false)
  
  // Load image: check IndexedDB cache first, then fall back to CDN
  useEffect(() => {
    if (!sku) {
      setLoading(false)
      setFailed(true)
      return
    }
    
    let cancelled = false
    
    const loadImage = async () => {
      setLoading(true)
      setFailed(false)
      setTriedPng(false)
      
      try {
        // First, check IndexedDB cache
        const cachedImage = await offlineStore.getImage(sku)
        
        if (cachedImage && !cancelled) {
          // Use cached base64 image
          console.log('ProductImage: Using cached image for', sku)
          setImageSrc(cachedImage)
          setLoading(false)
          return
        }
        
        // No cache - use CDN URL (will be loaded by browser)
        if (!cancelled) {
          console.log('ProductImage: No cache, using CDN for', sku)
          setImageSrc(getImageUrl(sku, 'medium', 'jpg'))
          setLoading(false)
        }
      } catch (err) {
        console.warn('ProductImage: Error loading cached image for', sku, err)
        // Fall back to CDN on any error
        if (!cancelled) {
          setImageSrc(getImageUrl(sku, 'medium', 'jpg'))
          setLoading(false)
        }
      }
    }
    
    loadImage()
    
    return () => {
      cancelled = true
    }
  }, [sku])
  
  // Handle CDN image load errors (try png, then fail)
  const handleError = () => {
    // Only try fallbacks for CDN URLs (not cached base64)
    if (imageSrc && imageSrc.startsWith('http')) {
      if (!triedPng) {
        // Try png as fallback
        console.log('ProductImage: jpg failed, trying png for', sku)
        setTriedPng(true)
        setImageSrc(getImageUrl(sku, 'medium', 'png'))
      } else {
        // Both failed, show placeholder
        console.log('ProductImage: Both jpg and png failed for', sku)
        setFailed(true)
      }
    } else {
      // Cached image failed to load (corrupted?), try CDN
      console.log('ProductImage: Cached image failed, trying CDN for', sku)
      setImageSrc(getImageUrl(sku, 'medium', 'jpg'))
    }
  }
  
  // Show placeholder while loading or if failed
  if (!sku || failed || loading) {
    return (
      <div 
        className={className} 
        style={{ 
          ...style, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          backgroundColor: '#f3f4f6',
          color: '#9ca3af'
        }}
        onClick={onClick}
      >
        <span style={{ fontSize: '0.75rem' }}>{loading ? '...' : 'No image'}</span>
      </div>
    )
  }
  
  return (
    <img
      src={imageSrc}
      alt={alt || sku}
      className={className}
      style={style}
      onClick={onClick}
      onError={handleError}
      loading="lazy"
    />
  )
}

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
  
  // Inactivity timeout (15 minutes)
  const INACTIVITY_TIMEOUT = 15 * 60 * 1000
  const inactivityTimerRef = useRef(null)
  const logoutRef = useRef(null)
  
  // Logout function - just clears session, keeps cache
  const performLogout = useCallback(() => {
    // Clear inactivity timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
    }
    
    // Clear session only (keep cache for offline use)
    localStorage.removeItem('token')
    localStorage.removeItem('agent')
    localStorage.removeItem('isAdmin')
    localStorage.removeItem('cart')
    localStorage.removeItem('selectedCustomer')
    
    setAgent(null)
    setIsAdmin(false)
  }, [])
  
  // Keep ref updated
  logoutRef.current = performLogout
  
  // Reset inactivity timer on user activity
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
    }
    
    // Only set timer if logged in
    if (localStorage.getItem('agent')) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log('Auto-logout due to inactivity')
        if (logoutRef.current) logoutRef.current()
      }, INACTIVITY_TIMEOUT)
    }
  }, [INACTIVITY_TIMEOUT])
  
  // Setup activity listeners
  useEffect(() => {
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    
    const handleActivity = () => {
      resetInactivityTimer()
    }
    
    // Add listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true })
    })
    
    // Start initial timer if logged in
    if (agent) {
      resetInactivityTimer()
    }
    
    return () => {
      // Cleanup
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity)
      })
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
      }
    }
  }, [agent, resetInactivityTimer])
  
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
    performLogout()
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
  const [showSyncPrompt, setShowSyncPrompt] = useState(false)
  const [showImagePrompt, setShowImagePrompt] = useState(false)
  const [syncPromptReason, setSyncPromptReason] = useState('')
  const stockIntervalRef = useRef(null)
  
  // In-memory caches for instant access
  const [customerCache, setCustomerCache] = useState([])
  const [customerCacheLoaded, setCustomerCacheLoaded] = useState(false)
  const [productCache, setProductCache] = useState([]) // All products in memory
  const [productCacheLoaded, setProductCacheLoaded] = useState(false)
  const [imageManifest, setImageManifest] = useState({}) // SKU -> list of image suffixes
  
  const refreshSyncStatus = async () => {
    const status = await syncService.getSyncStatus()
    setSyncStatus(status)
    return status
  }
  
  // Load customers into memory once for instant search
  const loadCustomerCache = async () => {
    try {
      const customers = await offlineStore.getCustomers()
      setCustomerCache(customers)
      setCustomerCacheLoaded(true)
      console.log('Customer cache loaded:', customers.length, 'customers')
    } catch (err) {
      console.error('Failed to load customer cache:', err)
    }
  }
  
  // Load ALL products into memory for instant filtering
  const loadProductCache = async () => {
    try {
      const products = await offlineStore.getProducts({})
      setProductCache(products)
      setProductCacheLoaded(true)
      console.log('Product cache loaded:', products.length, 'products')
    } catch (err) {
      console.error('Failed to load product cache:', err)
      setProductCacheLoaded(true) // Mark as loaded even on error
    }
  }
  
  // Load image manifest from backend (cached for 6 hours server-side)
  const loadImageManifest = async () => {
    if (!navigator.onLine) return
    try {
      const data = await apiRequest('/images/manifest')
      if (data.manifest) {
        setImageManifest(data.manifest)
        console.log('Image manifest loaded:', Object.keys(data.manifest).length, 'SKUs')
      }
    } catch (err) {
      console.error('Failed to load image manifest:', err)
    }
  }
  
  // Check if sync is needed and show prompts
  const checkSyncNeeded = async (status) => {
    if (!navigator.onLine || !localStorage.getItem('agent')) return
    
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000
    const TWELVE_HOURS = 12 * 60 * 60 * 1000
    
    // Check if data is missing or stale
    if (!status?.productCount || status.productCount === 0) {
      setSyncPromptReason('You have no product data cached. Sync now for offline access.')
      setShowSyncPrompt(true)
      return
    }
    
    if (!status?.customerCount || status.customerCount === 0) {
      setSyncPromptReason('You have no customer data cached. Sync now for offline access.')
      setShowSyncPrompt(true)
      return
    }
    
    // Check if last sync was more than 24 hours ago
    if (status?.lastProductSync) {
      const lastSync = new Date(status.lastProductSync).getTime()
      if (now - lastSync > ONE_DAY) {
        const hoursAgo = Math.round((now - lastSync) / (60 * 60 * 1000))
        setSyncPromptReason(`Your data is ${hoursAgo} hours old. Sync to get latest products and stock levels.`)
        setShowSyncPrompt(true)
        return
      }
    }
  }
  
  // Check if image download prompt should show
  const checkImagePrompt = (status) => {
    if (!navigator.onLine || !localStorage.getItem('agent')) return
    if (!status?.productCount || status.productCount === 0) return // No products synced yet
    
    // Get tracking data from localStorage
    const appOpens = parseInt(localStorage.getItem('dmb_app_opens') || '0') + 1
    localStorage.setItem('dmb_app_opens', appOpens.toString())
    
    const imagesDownloadedAt = localStorage.getItem('dmb_images_downloaded_at')
    const imagesProductCount = parseInt(localStorage.getItem('dmb_images_product_count') || '0')
    
    // If already downloaded and no new products, don't prompt
    if (imagesDownloadedAt && imagesProductCount >= status.productCount) {
      console.log('Images already downloaded, no new products')
      return
    }
    
    // Check if there are new products since last download
    const hasNewProducts = imagesDownloadedAt && status.productCount > imagesProductCount
    
    // Show prompt every 5th open, or if there are new products (and it's been at least 1 open since last prompt)
    const lastPromptOpen = parseInt(localStorage.getItem('dmb_last_image_prompt_open') || '0')
    
    if (hasNewProducts && appOpens > lastPromptOpen) {
      // New products available
      localStorage.setItem('dmb_last_image_prompt_open', appOpens.toString())
      setShowImagePrompt(true)
      return
    }
    
    if (!imagesDownloadedAt && appOpens % 5 === 0) {
      // Never downloaded, show every 5th open
      localStorage.setItem('dmb_last_image_prompt_open', appOpens.toString())
      setShowImagePrompt(true)
    }
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
    refreshSyncStatus().then(status => {
      // Small delay to let login state settle
      setTimeout(() => {
        checkSyncNeeded(status)
        checkImagePrompt(status)
      }, 1000)
    })
    
    // Load caches on mount
    loadCustomerCache()
    loadProductCache()
    loadImageManifest()
    
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
    setShowSyncPrompt(false) // Close prompt when sync starts
    try {
      // includeImages: false - images load on-demand to save API calls
      await syncService.fullSync({ includeImages: false }, onProgress)
      await refreshSyncStatus()
      // Refresh caches after sync
      await loadCustomerCache()
      await loadProductCache()
    } finally {
      setIsSyncing(false)
    }
  }
  
  const doImageDownload = async (onProgress) => {
    if (!navigator.onLine) return 0
    setShowImagePrompt(false)
    
    try {
      // Get products from cache
      const products = await offlineStore.getProducts()
      if (products.length === 0) return 0
      
      // Download images
      const count = await syncService.syncImages(products, onProgress)
      
      // Mark as downloaded with current product count
      localStorage.setItem('dmb_images_downloaded_at', new Date().toISOString())
      localStorage.setItem('dmb_images_product_count', products.length.toString())
      
      await refreshSyncStatus()
      return count
    } catch (err) {
      console.error('Image download failed:', err)
      throw err
    }
  }
  
  const dismissSyncPrompt = () => setShowSyncPrompt(false)
  const dismissImagePrompt = () => setShowImagePrompt(false)
  
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
      doImageDownload,
      submitPendingOrders,
      refreshSyncStatus,
      customerCache,
      customerCacheLoaded,
      refreshCustomerCache: loadCustomerCache,
      productCache,
      productCacheLoaded,
      refreshProductCache: loadProductCache,
      imageManifest,
      showSyncPrompt,
      showImagePrompt,
      syncPromptReason,
      dismissSyncPrompt,
      dismissImagePrompt
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

// Smart image component - uses Cloudinary CDN directly
function OfflineImage({ sku, alt, className, fallbackIcon = '📦', size = 'small', imageUrl = null }) {
  // Use IndexedDB cache first, then CDN as fallback
  const [imageSrc, setImageSrc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [triedPng, setTriedPng] = useState(false)
  
  // Load image: check IndexedDB cache first, then fall back to CDN
  useEffect(() => {
    // If imageUrl provided directly (e.g. Elvang), use it
    if (imageUrl) {
      setImageSrc(imageUrl)
      setLoading(false)
      return
    }
    
    if (!sku) {
      setLoading(false)
      setFailed(true)
      return
    }
    
    let cancelled = false
    
    const loadImage = async () => {
      setLoading(true)
      setFailed(false)
      setTriedPng(false)
      
      try {
        // First, check IndexedDB cache
        const cachedImage = await offlineStore.getImage(sku)
        
        if (cachedImage && !cancelled) {
          // Use cached base64 image
          console.log('📦 CACHE HIT:', sku)
          setImageSrc(cachedImage)
          setLoading(false)
          return
        }
        
        // No cache - use CDN URL (will be loaded by browser)
        if (!cancelled) {
          console.log('🌐 CDN LOAD:', sku)
          setImageSrc(getImageUrl(sku, size, 'jpg'))
          setLoading(false)
        }
      } catch (err) {
        // Fall back to CDN on any error
        if (!cancelled) {
          setImageSrc(getImageUrl(sku, size, 'jpg'))
          setLoading(false)
        }
      }
    }
    
    loadImage()
    
    return () => {
      cancelled = true
    }
  }, [sku, imageUrl, size])
  
  // Handle CDN image load errors (try png, then fail)
  const handleError = () => {
    // Only try fallbacks for CDN URLs (not cached base64 or custom imageUrl)
    if (imageSrc && imageSrc.startsWith('http') && !imageUrl) {
      if (!triedPng) {
        // Try png as fallback (My Flame products use .png)
        setTriedPng(true)
        setImageSrc(getImageUrl(sku, size, 'png'))
      } else {
        // Both failed, show placeholder
        setFailed(true)
      }
    } else if (imageSrc && imageSrc.startsWith('data:')) {
      // Cached image failed to load (corrupted?), try CDN
      setImageSrc(getImageUrl(sku, size, 'jpg'))
    } else {
      setFailed(true)
    }
  }
  
  // Show placeholder while loading or if failed
  if (!sku || failed || loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <span className="text-4xl">{loading && sku ? '' : fallbackIcon}</span>
      </div>
    )
  }
  
  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      onError={handleError}
      loading="lazy"
    />
  )
}

// Helper to get all possible image URLs for a product (main + variants)
const getProductImageUrls = (sku, size = 'medium') => {
  if (!sku) return []
  const urls = [getImageUrl(sku, size)] // Main image first
  // Add potential variant images (SKU_1, SKU_2, etc.)
  for (let i = 1; i <= 5; i++) {
    urls.push(getImageUrl(`${sku}_${i}`, size))
  }
  return urls
}

// Helper to format restock date for display
function formatRestockDate(dateStr) {
  if (!dateStr) return null
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function ProductDetailModal({ product, onClose, onAddToCart, germanStockInfo }) {
  const [extraImages, setExtraImages] = useState([]) // Additional images beyond main
  const [activeIndex, setActiveIndex] = useState(0)
  const [mainImageFailed, setMainImageFailed] = useState(false)
  const { imageManifest } = useOffline()
  
  // Main image URL - show immediately
  // Use product.image_url if available (e.g. Elvang), otherwise fall back to standard Cloudinary path
  const mainImageUrl = product?.image_url || (product?.sku ? getImageUrl(product.sku, 'medium') : null)
  
  // All valid images (main + extras)
  const allImages = mainImageUrl && !mainImageFailed ? [mainImageUrl, ...extraImages] : extraImages
  
  // Use image manifest for instant lookup - no HEAD requests needed!
  // Also reset state when product changes
  useEffect(() => {
    if (!product?.sku) return
    
    // Reset state for new product
    setActiveIndex(0)
    setMainImageFailed(false)
    
    // Check manifest for this SKU's images (convert dots to underscores for My Flame)
    const cloudinarySku = skuToCloudinaryId(product.sku)
    const suffixes = imageManifest[cloudinarySku] || []
    console.log('Image manifest lookup for', product.sku, '->', cloudinarySku, ':', suffixes)
    
    // Filter to only numbered suffixes (_1, _2, etc.) and build URLs
    // Use cloudinarySku (with underscores) for the URL
    const validExtras = suffixes
      .filter(suffix => suffix.match(/^_\d+$/)) // Only _1, _2, etc.
      .map(suffix => getImageUrl(`${cloudinarySku}${suffix}`, 'medium'))
    
    console.log('Extra images found:', validExtras.length)
    setExtraImages(validExtras)
  }, [product?.sku, imageManifest])
  
  if (!product) return null
  
  const handlePrev = (e) => {
    e.stopPropagation()
    setActiveIndex(i => (i > 0 ? i - 1 : allImages.length - 1))
  }
  
  const handleNext = (e) => {
    e.stopPropagation()
    setActiveIndex(i => (i < allImages.length - 1 ? i + 1 : 0))
  }
  
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
          
          {/* Main Image - shows immediately */}
          <div className="aspect-square bg-gray-100 relative">
            {allImages.length > 0 ? (
              <>
                <img
                  src={allImages[activeIndex]}
                  alt={product.name}
                  className="w-full h-full object-contain"
                  onError={() => activeIndex === 0 && setMainImageFailed(true)}
                />
                
                {/* Navigation arrows if multiple images */}
                {allImages.length > 1 && (
                  <>
                    <button
                      onClick={handlePrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full w-10 h-10 flex items-center justify-center text-xl shadow hover:bg-white transition"
                    >
                      ‹
                    </button>
                    <button
                      onClick={handleNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full w-10 h-10 flex items-center justify-center text-xl shadow hover:bg-white transition"
                    >
                      ›
                    </button>
                    
                    {/* Image counter */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-sm px-3 py-1 rounded-full">
                      {activeIndex + 1} / {allImages.length}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-6xl">📦</span>
              </div>
            )}
          </div>
          
          {/* Thumbnail strip if multiple images */}
          {allImages.length > 1 && (
            <div className="flex gap-2 p-2 bg-gray-50 overflow-x-auto">
              {allImages.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition ${
                    idx === activeIndex ? 'border-primary-500' : 'border-transparent'
                  }`}
                >
                  <img src={url} alt={`View ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-500">{product.sku}</p>
          <h2 className="text-xl font-bold text-gray-800">{product.name}</h2>
          
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-2xl font-bold text-primary-600">£{product.rate?.toFixed(2)}</span>
            <span className={`text-sm px-3 py-1 rounded-full ${product.stock_on_hand > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {product.stock_on_hand > 0 ? `${product.stock_on_hand} in stock` : 'Out of stock'}
            </span>
          </div>
          
          {/* German Stock Info */}
          {germanStockInfo && (
            <div className="flex items-center gap-2 flex-wrap">
              <span>🇩🇪</span>
              <span className={`text-sm px-3 py-1 rounded-full ${
                germanStockInfo.stock > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {germanStockInfo.stock < 10 && germanStockInfo.restock_date
                  ? `Due ${formatRestockDate(germanStockInfo.restock_date)}`
                  : germanStockInfo.stock > 0
                    ? `${germanStockInfo.stock} in Germany`
                    : 'Out in Germany'
                }
              </span>
              {germanStockInfo.new && (
                <span className="text-sm px-3 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                  ✨ New
                </span>
              )}
            </div>
          )}
          
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
          <img src="/logo.png" alt="DMB Logo" className="h-20 mx-auto mb-4" />
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
    // Open external URL directly in new tab
    if (catalogue.url) {
      window.open(catalogue.url, '_blank')
    }
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
            <img src="/logo.png" alt="DMB Logo" className="h-14" />
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
        
        {/* Catalogue Request - Trade Show / On the Road */}
        <div>
          <button
            onClick={() => window.location.href = '/show-capture.html'}
            className="w-full bg-gradient-to-r from-primary-400 to-primary-600 text-white rounded-xl p-4 flex items-center gap-4 transition active:scale-95 shadow-md hover:from-primary-500 hover:to-primary-700"
          >
            <span className="text-3xl">📝</span>
            <div className="text-left">
              <span className="font-semibold text-lg block">Catalogue Request</span>
              <span className="text-primary-100 text-sm">Capture new customer details</span>
            </div>
          </button>
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

const ITEMS_PER_PAGE = 8

function ProductsTab() {
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE)
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [prefetchedImages, setPrefetchedImages] = useState(new Set())
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('productsViewMode') || 'grid'
  })
  const [germanStock, setGermanStock] = useState(null)
  const [freshProducts, setFreshProducts] = useState(null) // Fresh data from API
  const [isFetchingProducts, setIsFetchingProducts] = useState(false) // Track API loading state
  const { cart, addToCart, updateQuantity } = useCart()
  const { agent } = useAuth()
  const { isOnline, productCache, productCacheLoaded } = useOffline()
  const { addToast } = useToast()
  const observerRef = useRef(null)
  const loadMoreRef = useRef(null)
  
  // INSTANT filtering from in-memory cache using useMemo
  const filteredProducts = useMemo(() => {
    // Use fresh API data if available, otherwise use cache
    const sourceProducts = freshProducts || productCache
    
    if (!selectedBrand || !sourceProducts.length) return []

    // Special filter: New products from last 90 days (across all agent's brands)
    if (selectedBrand === '__NEW_90_DAYS__') {
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

      let filtered = sourceProducts.filter(p => {
        if (!p.created_time) return false
        const createdDate = new Date(p.created_time)
        return createdDate >= ninetyDaysAgo
      })

      // Sort by created_time descending (newest first)
      filtered.sort((a, b) => new Date(b.created_time) - new Date(a.created_time))

      if (search) {
        const searchLower = search.toLowerCase()
        filtered = filtered.filter(p =>
          p.name?.toLowerCase().includes(searchLower) ||
          p.sku?.toLowerCase().includes(searchLower) ||
          p.ean?.toLowerCase().includes(searchLower) ||
          p.brand?.toLowerCase().includes(searchLower)
        )
      }

      return filtered
    }

    // Normalize brand names for comparison - remove spaces, lowercase, extract key words
    const normalizeForMatch = (str) => {
      if (!str) return ''
      return str.toLowerCase()
        .replace(/\s+/g, '') // Remove all spaces
        .replace(/gmbh|ltd|inc|llc/gi, '') // Remove company suffixes
    }

    // Also extract first meaningful word for partial matching
    const getKeyWord = (str) => {
      if (!str) return ''
      // Get first word that's not a common prefix
      const words = str.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      return words[0] || ''
    }

    const selectedNorm = normalizeForMatch(selectedBrand)
    const selectedKey = getKeyWord(selectedBrand)

    let filtered = sourceProducts.filter(p => {
    const productBrand = p.brand || ''
    if (!productBrand) return false // Skip products with no brand

    const productNorm = normalizeForMatch(productBrand)
    const productKey = getKeyWord(productBrand)

    // Match if normalized versions contain each other OR key words match
    return productNorm.includes(selectedNorm) ||
              selectedNorm.includes(productNorm) ||
             (selectedKey && productKey && productKey.length > 2 &&
              (productKey.includes(selectedKey) || selectedKey.includes(productKey)))
    })
    
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(p =>
        p.name?.toLowerCase().includes(searchLower) ||
        p.sku?.toLowerCase().includes(searchLower) ||
        p.ean?.toLowerCase().includes(searchLower)
      )
    }
    
    return filtered
  }, [selectedBrand, search, productCache, freshProducts])
  
  // Products currently visible (for infinite scroll)
  const products = filteredProducts.slice(0, visibleCount)
  const hasMore = visibleCount < filteredProducts.length
  const usingOffline = !freshProducts && productCache.length > 0
  
  // Reset visible count when brand/search changes
  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE)
    setPrefetchedImages(new Set())
  }, [selectedBrand, search])
  
  // Background refresh from API when brand selected
  useEffect(() => {
    if (selectedBrand && isOnline) {
      setIsFetchingProducts(true)
      apiRequest(`/products?page=1&limit=2000&brand=${encodeURIComponent(selectedBrand)}`)
        .then(data => {
          if (data.products?.length > 0) {
            setFreshProducts(data.products)
          }
        })
        .catch(err => console.log('Background refresh failed:', err))
        .finally(() => setIsFetchingProducts(false))
    }
    // Clear fresh products when brand changes
    setFreshProducts(null)
  }, [selectedBrand, isOnline])
  
  // Save view mode preference
  useEffect(() => {
    localStorage.setItem('productsViewMode', viewMode)
  }, [viewMode])
  
  // Fetch German stock when Räder or Remember brand is selected
  useEffect(() => {
    const fetchGermanStock = async () => {
      const brandLower = selectedBrand?.toLowerCase()
      const brandKey = brandLower === 'räder' ? 'raeder' : brandLower === 'remember' ? 'remember' : null

      if (brandKey && isOnline) {
        try {
          const data = await apiRequest(`/german-stock/${brandKey}`)
          setGermanStock(data)
          console.log('Loaded German stock:', data.item_count, 'items')
        } catch (err) {
          console.error('Failed to load German stock:', err)
          setGermanStock(null)
        }
      } else {
        setGermanStock(null)
      }
    }
    fetchGermanStock()
  }, [selectedBrand, isOnline])
  
  // Helper to get German stock for a product by SKU
  const getGermanStockInfo = (sku) => {
    if (!germanStock?.items || !sku) return null
    return germanStock.items[sku] || null
  }
  
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
  
  // Prefetch images for upcoming products (next 2 pages)
  const prefetchImages = useCallback((productsToPreload) => {
    productsToPreload.forEach(product => {
      if (product.sku && !prefetchedImages.has(product.sku)) {
        const img = new Image()
        img.src = getImageUrl(product.sku, 'small')
        setPrefetchedImages(prev => new Set([...prev, product.sku]))
      }
    })
  }, [prefetchedImages])
  
  // When visible products change, prefetch next 2 pages
  useEffect(() => {
    if (filteredProducts.length > 0 && viewMode === 'grid') {
      const nextStart = visibleCount
      const nextEnd = Math.min(visibleCount + (ITEMS_PER_PAGE * 2), filteredProducts.length)
      const nextProducts = filteredProducts.slice(nextStart, nextEnd)
      if (nextProducts.length > 0) {
        const timer = setTimeout(() => prefetchImages(nextProducts), 500)
        return () => clearTimeout(timer)
      }
    }
  }, [visibleCount, filteredProducts, viewMode, prefetchImages])
  
  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect()
    
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setVisibleCount(prev => Math.min(prev + ITEMS_PER_PAGE, filteredProducts.length))
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    )
    
    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }
    
    return () => {
      if (observerRef.current) observerRef.current.disconnect()
    }
  }, [hasMore, filteredProducts.length])
  
  // Show brand selector first
  if (!selectedBrand) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 bg-gray-50 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Select a Brand</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {agent?.brands?.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {/* New Products filter - shows items added in last 90 days across all brands */}
              <button
                onClick={() => setSelectedBrand('__NEW_90_DAYS__')}
                className="bg-gradient-to-br from-green-50 to-emerald-100 border-2 border-green-300 rounded-xl p-6 text-center hover:border-green-500 hover:from-green-100 hover:to-emerald-200 transition active:scale-95"
              >
                <span className="text-2xl mb-1 block">✨</span>
                <span className="font-semibold text-green-700">New Products</span>
                <span className="block text-xs text-green-600 mt-1">Last 90 days</span>
              </button>
              {agent.brands.filter(b => !['Elvang', 'Elvang Denmark', 'GEFU'].includes(b)).map(brand => (
                <button
                  key={brand}
                  onClick={() => setSelectedBrand(brand)}
                  className="bg-white border-2 border-gray-200 rounded-xl p-6 text-center hover:border-primary-500 hover:bg-primary-50 transition active:scale-95"
                >
                  <span className="font-semibold text-gray-800">{brand}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <span className="text-5xl mb-4">📦</span>
              <p>No brands assigned to your account</p>
              <p className="text-sm mt-2">Please contact admin</p>
            </div>
          )}
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
          <span className="font-semibold text-gray-800">
            {selectedBrand === '__NEW_90_DAYS__' ? '✨ New Products (90 days)' : selectedBrand}
          </span>
          {germanStock && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
              🇩🇪 Stock
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
        {(!productCacheLoaded || isFetchingProducts) && products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4"></div>
            <p className="text-center">Loading products, please wait...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-5xl mb-4">📦</span>
            <p className="text-center">No products found</p>
            {!isOnline && productCache.length === 0 && (
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
                const deStock = getGermanStockInfo(product.sku)
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
                        sku={product.sku}
                        alt={product.name}
                        className="w-full h-full object-contain"
                        fallbackIcon="📦"
                        imageUrl={product.image_url}
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
                      
                      {/* German Stock Badge */}
                      {deStock && (
                        <div className="flex items-center gap-1 mb-2 flex-wrap">
                          <span className="text-xs">🇩🇪</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            deStock.stock > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {deStock.stock < 10 && deStock.restock_date
                              ? `Due ${formatRestockDate(deStock.restock_date)}`
                              : deStock.stock > 0
                                ? deStock.stock
                                : 'Out'
                            }
                          </span>
                          {deStock.new && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">New</span>
                          )}
                        </div>
                      )}
                      
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
                germanStockInfo={getGermanStockInfo(selectedProduct.sku)}
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
                const deStock = getGermanStockInfo(product.sku)
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
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                        {/* German Stock Badge */}
                        {deStock && (
                          <>
                            <span className="flex items-center gap-0.5">
                              <span className="text-xs">🇩🇪</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                deStock.stock > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {deStock.stock < 10 && deStock.restock_date
                                  ? `Due ${formatRestockDate(deStock.restock_date)}`
                                  : deStock.stock > 0
                                    ? deStock.stock
                                    : 'Out'
                                }
                              </span>
                            </span>
                            {deStock.new && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">New</span>
                            )}
                          </>
                        )}
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
                germanStockInfo={getGermanStockInfo(selectedProduct.sku)}
              />
            )}
          </>
        )}
        
        {/* Infinite scroll trigger */}
        {hasMore && (
          <div ref={loadMoreRef} className="py-8 flex justify-center">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin"></div>
          </div>
        )}
        
        {/* Show total count */}
        {filteredProducts.length > 0 && (
          <div className="text-center text-sm text-gray-500 py-4">
            Showing {products.length} of {filteredProducts.length} products
          </div>
        )}
      </div>
    </div>
  )
}

function CustomersTab() {
  const [search, setSearch] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const { setCustomer, customer: selectedCustomer } = useCart()
  const { isOnline, customerCache, customerCacheLoaded, refreshCustomerCache } = useOffline()
  
  const debouncedSearch = useDebounce(search, 150)
  
  // Filter customers from in-memory cache (instant)
  const filteredCustomers = useMemo(() => {
    if (!debouncedSearch) return customerCache.slice(0, 50) // Show first 50 if no search
    
    const searchLower = debouncedSearch.toLowerCase()
    return customerCache
      .filter(c =>
        c.company_name?.toLowerCase().includes(searchLower) ||
        c.contact_name?.toLowerCase().includes(searchLower) ||
        c.email?.toLowerCase().includes(searchLower)
      )
      .slice(0, 50) // Limit to 50 results
  }, [customerCache, debouncedSearch])
  
  const handleSelectCustomer = (customer) => {
    setCustomer(customer)
  }
  
  const handleCustomerCreated = async (newCustomer) => {
    setCustomer(newCustomer)
    setShowNewForm(false)
    // Refresh in-memory cache
    await refreshCustomerCache()
  }
  
  if (showNewForm) {
    return <NewCustomerForm onBack={() => setShowNewForm(false)} onCreated={handleCustomerCreated} />
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
          {customerCache.length > 0 && (
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {filteredCustomers.length}{filteredCustomers.length === 50 ? '+' : ''}
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
        {!customerCacheLoaded ? (
          <LoadingSpinner />
        ) : filteredCustomers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
            <span className="text-4xl mb-2">👥</span>
            <p>{search ? 'No customers match your search' : 'No customers synced yet'}</p>
            <p className="text-sm text-gray-400 mt-1">Sync in Settings to load customers</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredCustomers.map(customer => (
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
  const [search, setSearch] = useState('')
  const { customerCache, customerCacheLoaded } = useOffline()
  
  const debouncedSearch = useDebounce(search, 150)
  
  // Filter from in-memory cache (instant)
  const filteredCustomers = useMemo(() => {
    if (!debouncedSearch) return customerCache.slice(0, 50)
    
    const searchLower = debouncedSearch.toLowerCase()
    return customerCache
      .filter(c =>
        c.company_name?.toLowerCase().includes(searchLower) ||
        c.contact_name?.toLowerCase().includes(searchLower) ||
        c.email?.toLowerCase().includes(searchLower)
      )
      .slice(0, 50)
  }, [customerCache, debouncedSearch])
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80dvh] sm:max-h-[80vh] flex flex-col">
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
          {!customerCacheLoaded ? (
            <LoadingSpinner />
          ) : filteredCustomers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>{search ? 'No customers match your search' : 'No customers synced'}</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredCustomers.map(customer => (
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

// Delivery Date Modal - appears when submitting order
function DeliveryDateModal({ onSubmit, onClose, isOnline, loading }) {
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  
  const handleSubmit = () => {
    if (!deliveryDate) {
      setError('Please select a delivery date')
      return
    }
    onSubmit({ deliveryDate, notes })
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">📅 Delivery Details</h2>
          <button onClick={onClose} className="text-gray-500 text-2xl">&times;</button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Required Delivery Date *</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => { setDeliveryDate(e.target.value); setError(''); }}
              min={new Date().toISOString().split('T')[0]}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Order Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="Any special instructions..."
            />
          </div>
          
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-gray-200 space-y-2">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`w-full py-4 rounded-xl font-semibold text-lg text-white transition ${
              isOnline ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'
            } disabled:opacity-50`}
          >
            {loading ? 'Submitting...' : isOnline ? '✓ Confirm & Submit Order' : '📴 Save Order Offline'}
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function CartTab({ onOrderSubmitted }) {
  const { cart, customer, setCustomer, cartTotal, updateQuantity, updateDiscount, clearCart } = useCart()
  const { isOnline, refreshSyncStatus } = useOffline()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [showPdfTypeModal, setShowPdfTypeModal] = useState(false)
  const [error, setError] = useState('')
  const [showCustomerSelect, setShowCustomerSelect] = useState(false)
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  
  // Calculate if delivery charge applies
  const needsDeliveryCharge = cartTotal < FREIGHT_FREE_THRESHOLD
  const amountToFreeDelivery = FREIGHT_FREE_THRESHOLD - cartTotal
  const orderTotal = needsDeliveryCharge ? cartTotal + DELIVERY_CHARGE : cartTotal
  
  // Generate PDF Quote - downloads directly for reliable iOS/Safari support
  const handleEmailQuote = async (docType = 'quote') => {
    setShowPdfTypeModal(false)
    
    if (cart.length === 0) {
      setError('Cart is empty')
      return
    }
    
    setGeneratingPdf(true)
    setError('')
    
    try {
      const token = localStorage.getItem('token')
      const agent = JSON.parse(localStorage.getItem('agent') || '{}')
      
      // Fetch cached images from IndexedDB for each cart item
      const { getImage } = await import('./offlineStore.js')
      const itemsWithImages = await Promise.all(cart.map(async (item) => {
        let imageData = null
        try {
          imageData = await getImage(item.sku)
        } catch (e) {
          console.log('No cached image for', item.sku)
        }
        return {
          item_id: item.item_id,
          name: item.name,
          sku: item.sku,
          ean: item.ean || '',
          rate: item.rate,
          quantity: item.quantity,
          discount: item.discount || 0,
          image_data: imageData  // base64 image or null
        }
      }))
      
      const response = await fetch(`${API_BASE}/export/quote-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          items: itemsWithImages,
          customer_name: customer?.company_name || 'Customer',
          customer_email: customer?.email || null,
          agent_name: agent?.name || 'Sales Agent',
          include_images: true,
          doc_type: docType
        })
      })
      
      if (!response.ok) {
        throw new Error('Failed to generate PDF')
      }
      
      const blob = await response.blob()
      const filename = response.headers.get('X-Filename') || `${docType}_${new Date().toISOString().split('T')[0]}.pdf`
      
      // Create blob URL
      const url = window.URL.createObjectURL(blob)
      
      // Check platform
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      
      if (isIOS) {
        // iOS (Safari or Chrome) - open PDF directly in current window
        // User can then use share button to save/email
        window.location.href = url
        addToast('PDF opened - use Share button to save or email', 'success')
      } else {
        // Desktop browsers - trigger download
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          document.body.removeChild(a)
          window.URL.revokeObjectURL(url)
        }, 10000)
        addToast('PDF downloaded!', 'success')
      }
      
    } catch (err) {
      console.error('PDF generation error:', err)
      setError(err.message)
      addToast('Failed to generate PDF', 'error')
    } finally {
      setGeneratingPdf(false)
    }
  }
  
  // Excel export
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
  
  // Called when user clicks Submit Order button
  const handleSubmitClick = () => {
    if (!customer) {
      setError('Please select a customer first')
      return
    }
    
    if (cart.length === 0) {
      setError('Cart is empty')
      return
    }
    
    setError('')
    setShowDeliveryModal(true)
  }
  
  // Called from the delivery modal with date and notes
  const handleSubmitOrder = async ({ deliveryDate, notes }) => {
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
        setShowDeliveryModal(false)
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
      setShowDeliveryModal(false)
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
      
      {showDeliveryModal && (
        <DeliveryDateModal
          onSubmit={handleSubmitOrder}
          onClose={() => setShowDeliveryModal(false)}
          isOnline={isOnline}
          loading={loading}
        />
      )}
      
      {showPdfTypeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-center">Generate PDF</h2>
              <p className="text-sm text-gray-500 text-center mt-1">Opens in new tab - use Share button to email/save</p>
            </div>
            <div className="p-4 space-y-3">
              <button
                onClick={() => handleEmailQuote('quote')}
                disabled={generatingPdf}
                className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {generatingPdf ? '⏳ Generating...' : '📋 Quote'}
              </button>
              <button
                onClick={() => handleEmailQuote('order')}
                disabled={generatingPdf}
                className="w-full py-4 bg-green-600 text-white rounded-xl font-semibold text-lg hover:bg-green-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {generatingPdf ? '⏳ Generating...' : '📦 Order Confirmation'}
              </button>
              <button
                onClick={() => setShowPdfTypeModal(false)}
                disabled={generatingPdf}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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
                      sku={item.sku}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      fallbackIcon="📦"
                      size="thumb"
                      imageUrl={item.image_url}
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
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-orange-800 font-medium text-xs">🚚 +£{DELIVERY_CHARGE.toFixed(2)} delivery</span>
                <span className="text-orange-600 text-xs">£{amountToFreeDelivery.toFixed(2)} to FREE</span>
              </div>
              <div className="w-full bg-orange-200 rounded-full h-1.5">
                <div 
                  className="bg-orange-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((cartTotal / FREIGHT_FREE_THRESHOLD) * 100, 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-2">
              <div className="flex items-center gap-2">
                <span className="text-green-600">✅</span>
                <span className="text-green-800 font-medium text-sm">FREE Delivery</span>
              </div>
            </div>
          )}
          
          {/* Order Summary - Compact */}
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
          
          <div className="flex gap-2">
            <button
              onClick={() => setShowPdfTypeModal(true)}
              disabled={generatingPdf}
              className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 disabled:opacity-50 transition"
            >
              {generatingPdf ? '...' : '📧 PDF'}
            </button>
            <button
              onClick={handleExportQuote}
              disabled={exporting}
              className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {exporting ? '...' : '📄 Excel'}
            </button>
            <button
              onClick={handleSubmitClick}
              disabled={loading || !customer}
              className={`flex-[2] text-white py-3 rounded-xl font-semibold text-lg disabled:opacity-50 transition ${
                isOnline ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {isOnline ? 'Submit Order →' : '📴 Save Offline →'}
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
      const packQty = r.product.pack_qty || 1
      addToCart(r.product, r.qty * packQty)
    })
    // Clear after adding
    setInput('')
    setResults([])
  }
  
  const handleAddSingle = (result) => {
    const packQty = result.product.pack_qty || 1
    addToCart(result.product, result.qty * packQty)
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
                        <span className="text-gray-500">× {result.qty}{result.found && result.product.pack_qty > 1 ? ` (${result.qty * result.product.pack_qty} units)` : ''}</span>
                        {result.partial && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">partial match</span>
                        )}
                      </div>
                      {result.found ? (
                        <div className="mt-1">
                          <p className="text-sm text-gray-800">{result.product.name}</p>
                          <p className="text-sm text-primary-600 font-medium">
                            £{result.product.rate?.toFixed(2)} each
                            {result.product.pack_qty > 1 && (
                              <span className="text-blue-600 ml-2">(pack of {result.product.pack_qty})</span>
                            )}
                          </p>
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

// Sync and Image Download Prompts
function SyncPrompts() {
  const { 
    showSyncPrompt, showImagePrompt, syncPromptReason,
    dismissSyncPrompt, dismissImagePrompt, doSync, doImageDownload,
    syncStatus
  } = useOffline()
  const { addToast } = useToast()
  const [syncing, setSyncing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState('')
  const { requestWakeLock, releaseWakeLock } = useWakeLock()
  
  const handleSync = async () => {
    setSyncing(true)
    setProgress('Starting sync...')
    await requestWakeLock()
    try {
      await doSync((p) => setProgress(p.message || 'Syncing...'))
      addToast('Sync complete!', 'success')
    } catch (err) {
      addToast('Sync failed: ' + err.message, 'error')
    } finally {
      releaseWakeLock()
      setSyncing(false)
      setProgress('')
    }
  }
  
  const handleImageDownload = async () => {
    setDownloading(true)
    setProgress('Starting download...')
    await requestWakeLock()
    try {
      const count = await doImageDownload((p) => setProgress(p.message || 'Downloading...'))
      addToast(`Downloaded ${count} images for offline use!`, 'success')
    } catch (err) {
      addToast('Download failed: ' + err.message, 'error')
    } finally {
      releaseWakeLock()
      setDownloading(false)
      setProgress('')
    }
  }
  
  // Sync Prompt Modal
  if (showSyncPrompt) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md">
          <div className="p-6 text-center">
            <div className="text-5xl mb-4">🔄</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Sync Recommended</h2>
            <p className="text-gray-600 mb-4">{syncPromptReason}</p>
            {progress && (
              <div className="text-sm text-blue-600 mb-4">
                <div>{progress}</div>
                <div className="text-xs text-gray-500 mt-1">📱 Screen will stay on during download</div>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-gray-200 space-y-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {syncing ? progress || 'Syncing...' : '🔄 Sync Now'}
            </button>
            <button
              onClick={dismissSyncPrompt}
              disabled={syncing}
              className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 disabled:opacity-50 transition"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  // Image Download Prompt Modal
  if (showImagePrompt) {
    const hasNewProducts = localStorage.getItem('dmb_images_downloaded_at') && 
      syncStatus?.productCount > parseInt(localStorage.getItem('dmb_images_product_count') || '0')
    
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md">
          <div className="p-6 text-center">
            <div className="text-5xl mb-4">🖼️</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">
              {hasNewProducts ? 'New Products Available' : 'Download Images for Offline?'}
            </h2>
            <p className="text-gray-600 mb-4">
              {hasNewProducts 
                ? 'There are new product images available. Download them for faster offline browsing?'
                : 'Pre-download all product images now for faster browsing and offline access. This may take a few minutes on slower connections.'
              }
            </p>
            {progress && (
              <div className="text-sm text-purple-600 mb-4">
                <div>{progress}</div>
                <div className="text-xs text-gray-500 mt-1">📱 Screen will stay on during download</div>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-gray-200 space-y-2">
            <button
              onClick={handleImageDownload}
              disabled={downloading}
              className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 disabled:opacity-50 transition"
            >
              {downloading ? progress || 'Downloading...' : '✓ Yes, Download Images'}
            </button>
            <button
              onClick={dismissImagePrompt}
              disabled={downloading}
              className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 disabled:opacity-50 transition"
            >
              No Thanks
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  return null
}

// Catalogue Requests Section Component (Admin)
function CatalogueRequestsSection() {
  const [requests, setRequests] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const { addToast } = useToast()
  
  const loadRequests = async () => {
    try {
      setLoading(true)
      const data = await apiRequest('/admin/catalogue-requests')
      setRequests(data.requests || [])
      setUnreadCount(data.unread || 0)
    } catch (err) {
      console.error('Failed to load catalogue requests:', err)
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    loadRequests()
  }, [])
  
  const handleMarkRead = async (requestId) => {
    try {
      await apiRequest(`/admin/catalogue-requests/${requestId}/read`, { method: 'PUT' })
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, is_read: true } : r))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      addToast('Failed to mark as read', 'error')
    }
  }
  
  const handleMarkAllRead = async () => {
    try {
      await apiRequest('/admin/catalogue-requests/mark-all-read', { method: 'PUT' })
      setRequests(prev => prev.map(r => ({ ...r, is_read: true })))
      setUnreadCount(0)
      addToast('All marked as read', 'success')
    } catch (err) {
      addToast('Failed to mark all as read', 'error')
    }
  }
  
  const handleDelete = async (requestId) => {
    if (!confirm('Delete this catalogue request?')) return
    try {
      await apiRequest(`/admin/catalogue-requests/${requestId}`, { method: 'DELETE' })
      const deleted = requests.find(r => r.id === requestId)
      setRequests(prev => prev.filter(r => r.id !== requestId))
      if (deleted && !deleted.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
      setSelectedRequest(null)
      addToast('Request deleted', 'success')
    } catch (err) {
      addToast('Failed to delete', 'error')
    }
  }
  
  const handleExportToExcel = (exportAll = false) => {
    const toExport = exportAll ? requests : requests.filter(r => !r.is_read)
    if (toExport.length === 0) {
      addToast('No requests to export', 'error')
      return
    }
    
    // Build CSV content
    const headers = ['Date', 'Business Name', 'First Name', 'Surname', 'Email', 'Phone', 'Address', 'Town', 'Postcode', 'Format', 'Brands', 'Notes']
    const rows = toExport.map(req => [
      req.created_at ? new Date(req.created_at).toLocaleDateString('en-GB') : '',
      req.business_name || '',
      req.first_name || '',
      req.surname || '',
      req.email || '',
      req.phone || '',
      [req.address1, req.address2].filter(Boolean).join(', '),
      req.town || '',
      req.postcode || '',
      req.catalogue_format || '',
      (req.brands || []).join('; '),
      req.notes || ''
    ])
    
    // Create CSV
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n')
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    const dateStr = new Date().toISOString().split('T')[0]
    link.download = `catalogue-requests-${exportAll ? 'all' : 'new'}-${dateStr}.csv`
    link.click()
    
    addToast(`Exported ${toExport.length} requests`, 'success')
  }
  
  const handlePrint = (printAll = false) => {
    const toPrint = printAll ? requests : requests.filter(r => !r.is_read)
    if (toPrint.length === 0) {
      addToast('No requests to print', 'error')
      return
    }
    
    const printWindow = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Catalogue Requests - ${printAll ? 'All' : 'New'}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 11px; line-height: 1.4; padding: 20px; }
          h1 { font-size: 18px; margin-bottom: 5px; }
          .subtitle { color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
          th { background: #f5f5f5; font-weight: bold; white-space: nowrap; }
          tr:nth-child(even) { background: #fafafa; }
          .brands { font-size: 10px; color: #666; }
          .notes { font-style: italic; font-size: 10px; color: #888; }
          .new-badge { background: #3b82f6; color: white; padding: 2px 6px; border-radius: 10px; font-size: 9px; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <h1>Catalogue Requests - ${printAll ? 'All' : 'New Only'}</h1>
        <div class="subtitle">Printed: ${dateStr} | Total: ${toPrint.length} requests</div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Business</th>
              <th>Contact</th>
              <th>Email / Phone</th>
              <th>Address</th>
              <th>Format</th>
              <th>Brands</th>
            </tr>
          </thead>
          <tbody>
            ${toPrint.map(req => `
              <tr>
                <td>${req.created_at ? new Date(req.created_at).toLocaleDateString('en-GB') : ''} ${!req.is_read ? '<span class="new-badge">NEW</span>' : ''}</td>
                <td><strong>${req.business_name || ''}</strong></td>
                <td>${req.first_name || ''} ${req.surname || ''}</td>
                <td>${req.email || ''}<br/>${req.phone || ''}</td>
                <td>${[req.address1, req.address2, req.town, req.postcode].filter(Boolean).join(', ')}</td>
                <td>${req.catalogue_format || ''}</td>
                <td><span class="brands">${(req.brands || []).join(', ')}</span>${req.notes ? `<br/><span class="notes">Note: ${req.notes}</span>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `)
    printWindow.document.close()
  }
  
  const formatDate = (isoString) => {
    if (!isoString) return ''
    const date = new Date(isoString)
    return date.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div 
        className="p-4 border-b border-gray-200 flex justify-between items-center cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg">📋 Catalogue Requests</h3>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
              {unreadCount} new
            </span>
          )}
        </div>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </div>
      
      {expanded && (
        <div>
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent mx-auto"></div>
            </div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <span className="text-4xl">📭</span>
              <p className="mt-2">No catalogue requests yet</p>
            </div>
          ) : (
            <>
              <div className="p-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center flex-wrap gap-2">
                <div className="flex gap-3">
                  {unreadCount > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMarkAllRead(); }}
                      className="text-sm text-primary-600 font-medium hover:underline"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportToExcel(false); }}
                      className="text-sm bg-green-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-green-700 transition"
                    >
                      📥 Export New
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExportToExcel(true); }}
                    className="text-sm bg-gray-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-gray-700 transition"
                  >
                    📥 Export All
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePrint(true); }}
                    className="text-sm bg-blue-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-blue-700 transition"
                  >
                    🖨️ Print
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-100 max-h-96 overflow-auto">
                {requests.map(req => (
                  <div 
                    key={req.id} 
                    className={`p-4 cursor-pointer transition hover:bg-gray-50 ${!req.is_read ? 'bg-blue-50' : ''}`}
                    onClick={() => {
                      setSelectedRequest(req)
                      if (!req.is_read) handleMarkRead(req.id)
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {!req.is_read && <span className="w-2 h-2 bg-blue-500 rounded-full"></span>}
                          <span className="font-medium">{req.business_name}</span>
                        </div>
                        <div className="text-sm text-gray-500">
                          {req.first_name} {req.surname} • {req.email}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {formatDate(req.created_at)} • {req.catalogue_format}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {req.brands?.slice(0, 2).map(brand => (
                          <span key={brand} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {brand.length > 8 ? brand.substring(0, 8) + '...' : brand}
                          </span>
                        ))}
                        {req.brands?.length > 2 && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            +{req.brands.length - 2}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      
      {/* Request Detail Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-lg font-bold">Catalogue Request</h2>
              <button onClick={() => setSelectedRequest(null)} className="text-gray-500 text-2xl">&times;</button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-primary-600 mb-2">Business Details</h3>
                <p className="font-medium text-lg">{selectedRequest.business_name}</p>
                <p className="text-sm text-gray-600">
                  {selectedRequest.address1}<br/>
                  {selectedRequest.address2 && <>{selectedRequest.address2}<br/></>}
                  {selectedRequest.town}, {selectedRequest.postcode}
                </p>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-primary-600 mb-2">Contact</h3>
                <p className="font-medium">{selectedRequest.first_name} {selectedRequest.surname}</p>
                <p className="text-sm">
                  <a href={`mailto:${selectedRequest.email}`} className="text-blue-600 hover:underline">
                    {selectedRequest.email}
                  </a>
                </p>
                {selectedRequest.phone && (
                  <p className="text-sm">
                    <a href={`tel:${selectedRequest.phone}`} className="text-blue-600 hover:underline">
                      {selectedRequest.phone}
                    </a>
                  </p>
                )}
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-primary-600 mb-2">Request</h3>
                <p className="text-sm mb-2">
                  <span className="font-medium">Format:</span> {selectedRequest.catalogue_format}
                </p>
                <p className="text-sm font-medium mb-1">Brands:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedRequest.brands?.map(brand => (
                    <span key={brand} className="bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm">
                      {brand}
                    </span>
                  ))}
                </div>
              </div>
              
              {selectedRequest.notes && (
                <div className="bg-yellow-50 rounded-lg p-4">
                  <h3 className="font-semibold text-yellow-700 mb-2">Notes</h3>
                  <p className="text-sm text-gray-700">{selectedRequest.notes}</p>
                </div>
              )}
              
              <div className="text-xs text-gray-400 text-center">
                Submitted: {formatDate(selectedRequest.created_at)}
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-200 flex gap-2">
              <a
                href={`mailto:${selectedRequest.email}?subject=Your DM Brands Catalogue Request&body=Dear ${selectedRequest.first_name},%0D%0A%0D%0AThank you for your interest in DM Brands...`}
                className="flex-1 py-3 bg-primary-600 text-white rounded-xl font-semibold text-center"
              >
                📧 Email Customer
              </a>
              <button
                onClick={() => handleDelete(selectedRequest.id)}
                className="py-3 px-4 bg-red-100 text-red-600 rounded-xl font-semibold"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Stock Reorder Section Component
function StockReorderSection() {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [selectedItems, setSelectedItems] = useState({}) // {supplier: {sku: {item, qty}}}
  const [expandedSuppliers, setExpandedSuppliers] = useState({})
  const [creatingPO, setCreatingPO] = useState(null)
  const [brandFilter, setBrandFilter] = useState('')
  
  const { addToast } = useToast()

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    setReport(null)
    setSelectedItems({})
    
    try {
      const params = brandFilter ? `?brands=${encodeURIComponent(brandFilter)}` : ''
      const data = await apiRequest(`/admin/reorder/analysis${params}`)
      setReport(data)
      
      // Auto-expand suppliers with items needing reorder
      const expanded = {}
      data.suppliers?.forEach(s => {
        if (s.reorder_items?.length > 0) {
          expanded[s.supplier] = true
        }
      })
      setExpandedSuppliers(expanded)
      
      addToast(`Analysis complete: ${data.summary?.total_reorder_skus || 0} SKUs need reorder`, 'success')
    } catch (err) {
      setError(err.message)
      addToast('Analysis failed: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const toggleSupplier = (supplier) => {
    setExpandedSuppliers(prev => ({
      ...prev,
      [supplier]: !prev[supplier]
    }))
  }

  const toggleItem = (supplier, item, isTopup = false) => {
    setSelectedItems(prev => {
      const supplierItems = prev[supplier] || {}
      const key = item.sku
      
      if (supplierItems[key]) {
        // Remove item
        const { [key]: removed, ...rest } = supplierItems
        if (Object.keys(rest).length === 0) {
          const { [supplier]: removed2, ...restSuppliers } = prev
          return restSuppliers
        }
        return { ...prev, [supplier]: rest }
      } else {
        // Add item
        return {
          ...prev,
          [supplier]: {
            ...supplierItems,
            [key]: {
              ...item,
              quantity: item.suggested_qty,
              isTopup
            }
          }
        }
      }
    })
  }

  const updateItemQty = (supplier, sku, qty) => {
    setSelectedItems(prev => ({
      ...prev,
      [supplier]: {
        ...prev[supplier],
        [sku]: {
          ...prev[supplier][sku],
          quantity: Math.max(0, parseInt(qty) || 0)
        }
      }
    }))
  }

  const selectAllReorderItems = (supplier, items) => {
    setSelectedItems(prev => {
      const supplierItems = {}
      items.forEach(item => {
        supplierItems[item.sku] = {
          ...item,
          quantity: item.suggested_qty,
          isTopup: false
        }
      })
      return { ...prev, [supplier]: { ...prev[supplier], ...supplierItems } }
    })
  }

  const clearSupplierSelection = (supplier) => {
    setSelectedItems(prev => {
      const { [supplier]: removed, ...rest } = prev
      return rest
    })
  }

  const getSupplierTotal = (supplier) => {
    const items = selectedItems[supplier] || {}
    return Object.values(items).reduce((sum, item) => {
      return sum + (item.quantity * item.cost_price)
    }, 0)
  }

  const getSelectedCount = (supplier) => {
    return Object.keys(selectedItems[supplier] || {}).length
  }

  const handleExportExcel = async (supplier) => {
    const items = selectedItems[supplier]
    if (!items || Object.keys(items).length === 0) {
      addToast('No items selected', 'error')
      return
    }

    setCreatingPO(supplier)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_BASE}/admin/reorder/export-excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          supplier,
          items: Object.values(items).map(item => ({
            sku: item.sku,
            item_id: item.item_id,
            name: item.name,
            quantity: item.quantity,
            cost_price: item.cost_price
          }))
        })
      })

      if (!response.ok) throw new Error('Export failed')

      // Download the file
      const blob = await response.blob()
      const filename = response.headers.get('X-Filename') || `${supplier}_PO.xlsx`
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()

      addToast(`Excel exported: ${filename}`, 'success')
    } catch (err) {
      addToast('Export failed: ' + err.message, 'error')
    } finally {
      setCreatingPO(null)
    }
  }

  const handleCreateZohoPO = async (supplier) => {
    const items = selectedItems[supplier]
    if (!items || Object.keys(items).length === 0) {
      addToast('No items selected', 'error')
      return
    }

    if (!confirm(`Create Zoho PO for ${supplier} with ${Object.keys(items).length} items?`)) return

    setCreatingPO(supplier)
    try {
      const result = await apiRequest('/admin/reorder/create-po', {
        method: 'POST',
        body: JSON.stringify({
          supplier,
          items: Object.values(items).map(item => ({
            sku: item.sku,
            item_id: item.item_id,
            name: item.name,
            quantity: item.quantity,
            cost_price: item.cost_price
          }))
        })
      })

      addToast(`PO ${result.purchaseorder_number} created!`, 'success')
      clearSupplierSelection(supplier)
    } catch (err) {
      addToast('Failed to create PO: ' + err.message, 'error')
    } finally {
      setCreatingPO(null)
    }
  }

  // Format currency
  const formatEUR = (value) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'EUR'
    }).format(value)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-lg flex items-center gap-2">
              📦 Stock Reorder
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Identify SKUs below 5 weeks cover, grouped by supplier
            </p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 transition flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin">⏳</span>
                Analysing...
              </>
            ) : (
              <>
                🔄 Run Analysis
              </>
            )}
          </button>
        </div>

        {/* Brand Filter */}
        <div className="mt-3">
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">All Brands</option>
            <option value="Räder">Räder</option>
            <option value="Relaxound">Relaxound</option>
            <option value="Ideas4Seasons">Ideas4Seasons</option>
            <option value="My Flame">My Flame</option>
            <option value="PPD">PPD</option>
            <option value="Elvang">Elvang</option>
            <option value="GEFU">GEFU</option>
            <option value="Remember">Remember</option>
          </select>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border-b border-red-100">
          <div className="text-red-600 font-medium">Error</div>
          <div className="text-red-500 text-sm">{error}</div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="p-8 text-center">
          <div className="animate-spin text-4xl mb-2">⏳</div>
          <div className="text-gray-500">Running analysis...</div>
          <div className="text-gray-400 text-sm mt-1">This may take a minute</div>
        </div>
      )}

      {/* Report Summary */}
      {report && !loading && (
        <>
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-orange-600">
                  {report.summary?.total_reorder_skus || 0}
                </div>
                <div className="text-xs text-gray-500">SKUs Need Reorder</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-blue-600">
                  {formatEUR(report.summary?.total_reorder_value_eur || 0)}
                </div>
                <div className="text-xs text-gray-500">Total Value</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-gray-600">
                  {report.summary?.supplier_count || 0}
                </div>
                <div className="text-xs text-gray-500">Suppliers</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="text-2xl font-bold text-red-600">
                  {report.summary?.suppliers_below_minimum || 0}
                </div>
                <div className="text-xs text-gray-500">Below Minimum</div>
              </div>
            </div>
            <div className="text-xs text-gray-400 mt-2">
              Generated: {new Date(report.generated_at).toLocaleString()}
            </div>
          </div>

          {/* Suppliers List */}
          <div className="divide-y divide-gray-100">
            {report.suppliers?.map(supplier => {
              const isExpanded = expandedSuppliers[supplier.supplier]
              const selectedCount = getSelectedCount(supplier.supplier)
              const selectedTotal = getSupplierTotal(supplier.supplier)
              const meetsMinimum = selectedTotal >= supplier.minimum_eur
              
              return (
                <div key={supplier.supplier} className="border-b border-gray-100 last:border-b-0">
                  {/* Supplier Header */}
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-50 transition"
                    onClick={() => toggleSupplier(supplier.supplier)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{isExpanded ? '▼' : '▶'}</span>
                        <div>
                          <div className="font-semibold text-lg">{supplier.supplier}</div>
                          <div className="text-sm text-gray-500">
                            Min: {formatEUR(supplier.minimum_eur)} • 
                            {supplier.summary?.reorder_count || 0} items need reorder •
                            {supplier.summary?.topup_count || 0} top-up candidates
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${supplier.meets_minimum ? 'text-green-600' : 'text-orange-600'}`}>
                          {formatEUR(supplier.reorder_total_eur)}
                        </div>
                        {!supplier.meets_minimum && supplier.gap_to_minimum > 0 && (
                          <div className="text-xs text-orange-500">
                            Gap: {formatEUR(supplier.gap_to_minimum)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-2">
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            supplier.meets_minimum ? 'bg-green-500' : 'bg-orange-500'
                          }`}
                          style={{
                            width: `${Math.min(100, (supplier.reorder_total_eur / supplier.minimum_eur) * 100)}%`
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      {/* Selection Summary & Actions */}
                      {selectedCount > 0 && (
                        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium text-blue-800">
                                {selectedCount} items selected
                              </span>
                              <span className="text-blue-600 ml-2">
                                = {formatEUR(selectedTotal)}
                              </span>
                              {!meetsMinimum && (
                                <span className="text-orange-600 ml-2 text-sm">
                                  (Need {formatEUR(supplier.minimum_eur - selectedTotal)} more)
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); clearSupplierSelection(supplier.supplier) }}
                                className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Reorder Items */}
                      {supplier.reorder_items?.length > 0 && (
                        <div className="mb-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium text-red-700 flex items-center gap-2">
                              🚨 Reorder Now ({supplier.reorder_items.length})
                            </h4>
                            <button
                              onClick={(e) => { e.stopPropagation(); selectAllReorderItems(supplier.supplier, supplier.reorder_items) }}
                              className="text-xs text-primary-600 hover:underline"
                            >
                              Select All
                            </button>
                          </div>
                          <div className="space-y-1">
                            {supplier.reorder_items.map(item => {
                              const isSelected = selectedItems[supplier.supplier]?.[item.sku]
                              return (
                                <div
                                  key={item.sku}
                                  className={`p-2 rounded-lg border transition ${
                                    isSelected
                                      ? 'bg-blue-50 border-blue-300'
                                      : 'bg-white border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={!!isSelected}
                                      onChange={() => toggleItem(supplier.supplier, item)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-5 h-5 rounded border-gray-300 text-primary-600"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm truncate">{item.name}</div>
                                      <div className="text-xs text-gray-500">
                                        SKU: {item.sku} • Stock: {item.current_stock}{item.committed_stock > 0 && ` (${item.committed_stock} committed)`}
                                        {item.open_po_qty > 0 && ` • +${item.open_po_qty} on PO`}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className={`text-sm font-medium ${
                                        item.weeks_of_cover < 3 ? 'text-red-600' : 'text-orange-600'
                                      }`}>
                                        {item.weeks_of_cover.toFixed(1)}w cover
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {item.weekly_velocity}/wk
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0 w-20">
                                      {isSelected ? (
                                        <input
                                          type="number"
                                          value={isSelected.quantity}
                                          onChange={(e) => updateItemQty(supplier.supplier, item.sku, e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-right"
                                          min="0"
                                        />
                                      ) : (
                                        <span className="text-sm text-gray-600">
                                          Sug: {item.suggested_qty}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-right shrink-0 w-20">
                                      <div className="text-sm font-medium">
                                        {formatEUR(isSelected ? isSelected.quantity * item.cost_price : item.order_value)}
                                      </div>
                                      <div className="text-xs text-gray-400">
                                        @{formatEUR(item.cost_price)}
                                      </div>
                                    </div>
                                  </div>
                                  {item.status !== 'normal' && (
                                    <div className="mt-1 ml-8">
                                      <span className={`text-xs px-2 py-0.5 rounded ${
                                        item.status === 'anomaly' ? 'bg-yellow-100 text-yellow-700' :
                                        item.status === 'new' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-600'
                                      }`}>
                                        {item.status === 'anomaly' ? '⚠️ Anomaly - Review' :
                                         item.status === 'new' ? '🆕 New Product' :
                                         item.status}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Top-up Candidates */}
                      {supplier.topup_candidates?.length > 0 && !supplier.meets_minimum && (
                        <div className="mb-4">
                          <h4 className="font-medium text-blue-700 mb-2 flex items-center gap-2">
                            📈 Top-up Candidates ({supplier.topup_candidates.length})
                            <span className="text-xs font-normal text-gray-500">
                              (Add to reach minimum)
                            </span>
                          </h4>
                          <div className="space-y-1">
                            {supplier.topup_candidates.slice(0, 10).map(item => {
                              const isSelected = selectedItems[supplier.supplier]?.[item.sku]
                              return (
                                <div
                                  key={item.sku}
                                  className={`p-2 rounded-lg border transition ${
                                    isSelected
                                      ? 'bg-blue-50 border-blue-300'
                                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={!!isSelected}
                                      onChange={() => toggleItem(supplier.supplier, item, true)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-5 h-5 rounded border-gray-300 text-primary-600"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm truncate">{item.name}</div>
                                      <div className="text-xs text-gray-500">SKU: {item.sku}</div>
                                    </div>
                                    <div className="text-sm text-gray-600 shrink-0">
                                      {item.weeks_of_cover.toFixed(1)}w cover
                                    </div>
                                    <div className="text-right shrink-0 w-20">
                                      {isSelected ? (
                                        <input
                                          type="number"
                                          value={isSelected.quantity}
                                          onChange={(e) => updateItemQty(supplier.supplier, item.sku, e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-right"
                                          min="0"
                                        />
                                      ) : (
                                        <span className="text-sm text-gray-500">
                                          Sug: {item.suggested_qty}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-sm font-medium shrink-0 w-20 text-right">
                                      {formatEUR(isSelected ? isSelected.quantity * item.cost_price : item.order_value)}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                            {supplier.topup_candidates.length > 10 && (
                              <div className="text-sm text-gray-500 text-center py-2">
                                +{supplier.topup_candidates.length - 10} more candidates
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      {selectedCount > 0 && (
                        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExportExcel(supplier.supplier) }}
                            disabled={creatingPO === supplier.supplier}
                            className="flex-1 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                          >
                            {creatingPO === supplier.supplier ? '⏳' : '📥'}
                            Export Excel
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCreateZohoPO(supplier.supplier) }}
                            disabled={creatingPO === supplier.supplier}
                            className="flex-1 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                          >
                            {creatingPO === supplier.supplier ? '⏳' : '📦'}
                            Create Zoho PO
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Empty State */}
          {report.suppliers?.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              <span className="text-4xl">✅</span>
              <p className="mt-2">All stock levels healthy!</p>
              <p className="text-sm">No SKUs below 5 weeks cover</p>
            </div>
          )}
        </>
      )}

      {/* Initial State */}
      {!report && !loading && !error && (
        <div className="p-8 text-center text-gray-500">
          <span className="text-4xl">📊</span>
          <p className="mt-2">Click "Run Analysis" to check stock levels</p>
          <p className="text-sm mt-1">Compares current stock against seasonal velocity</p>
        </div>
      )}
    </div>
  )
}

// Admin Panel (only for admins)
function AdminTab() {
  const [agents, setAgents] = useState([])
  const [availableBrands, setAvailableBrands] = useState([])
  const [catalogues, setCatalogues] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingAgent, setEditingAgent] = useState(null)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [showUploadCatalogue, setShowUploadCatalogue] = useState(false)
  const [editingCatalogue, setEditingCatalogue] = useState(null)
  const [feedGeneration, setFeedGeneration] = useState({ running: false, result: null })
  const { addToast } = useToast()
  
  const loadData = async () => {
    try {
      setLoading(true)
      const [agentsData, statsData, cataloguesData] = await Promise.all([
        apiRequest('/admin/agents'),
        apiRequest('/admin/stats'),
        apiRequest('/admin/catalogues')
      ])
      setAgents(agentsData.agents || [])
      setAvailableBrands(agentsData.available_brands || [])
      setCatalogues(cataloguesData.catalogues || [])
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
  
  const handleSaveCatalogue = async (catalogueData, isEdit = false) => {
    try {
      if (isEdit && catalogueData.id) {
        await apiRequest(`/admin/catalogues/${catalogueData.id}`, {
          method: 'PUT',
          body: JSON.stringify(catalogueData)
        })
        addToast('Catalogue updated successfully', 'success')
        setEditingCatalogue(null)
      } else {
        await apiRequest('/admin/catalogues', {
          method: 'POST',
          body: JSON.stringify(catalogueData)
        })
        addToast('Catalogue added successfully', 'success')
        setShowUploadCatalogue(false)
      }
      loadData()
    } catch (err) {
      addToast('Failed to save: ' + err.message, 'error')
    }
  }
  
  const handleDeleteCatalogue = async (catalogueId) => {
    if (!confirm('Are you sure you want to delete this catalogue?')) return
    try {
      await apiRequest(`/admin/catalogues/${catalogueId}`, { method: 'DELETE' })
      addToast('Catalogue deleted', 'success')
      loadData()
    } catch (err) {
      addToast('Failed to delete: ' + err.message, 'error')
    }
  }
  
  const handleMoveCatalogue = async (index, direction) => {
    const newCatalogues = [...catalogues]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    
    if (targetIndex < 0 || targetIndex >= newCatalogues.length) return
    
    // Swap positions
    [newCatalogues[index], newCatalogues[targetIndex]] = [newCatalogues[targetIndex], newCatalogues[index]]
    
    // Optimistically update UI
    setCatalogues(newCatalogues)
    
    // Save new order to backend
    try {
      const reorderData = newCatalogues.map((cat, idx) => ({ id: cat.id, sort_order: idx }))
      await apiRequest('/admin/catalogues/reorder', {
        method: 'POST',
        body: JSON.stringify(reorderData)
      })
    } catch (err) {
      addToast('Failed to reorder: ' + err.message, 'error')
      loadData() // Reload to get correct order
    }
  }
  
  const handleRegenerateFeed = async () => {
    setFeedGeneration({ running: true, result: null })
    try {
      const result = await apiRequest('/admin/generate-feed', { method: 'POST' })
      setFeedGeneration({ running: false, result })
      if (result.success) {
        addToast(`Feed regenerated: ${result.total_products} products`, 'success')
      } else {
        addToast('Feed generation failed', 'error')
      }
    } catch (err) {
      console.error('Feed generation error:', err)
      setFeedGeneration({ running: false, result: { error: err.message } })
      addToast('Feed generation failed: ' + err.message, 'error')
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
      
      {/* Catalogue Requests Section */}
      <CatalogueRequestsSection />
      
      {/* Product Feed Section */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <h3 className="font-semibold mb-3">📦 Product Feed</h3>
        <p className="text-sm text-gray-600 mb-3">
          Regenerate the static product feed used for offline sync. This fetches all products from Zoho and updates the feed cache.
        </p>

        <button
          onClick={handleRegenerateFeed}
          disabled={feedGeneration.running}
          className="w-full py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 transition"
        >
          {feedGeneration.running ? 'Generating...' : 'Regenerate Feed'}
        </button>

        {feedGeneration.result && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${feedGeneration.result.error ? 'bg-red-50' : 'bg-green-50'}`}>
            {feedGeneration.result.error ? (
              <div className="text-red-600">
                <strong>Error:</strong> {feedGeneration.result.error}
              </div>
            ) : (
              <div className="text-green-700">
                <strong>Success!</strong> Feed updated with {feedGeneration.result.total_products} products.
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Stock Reorder Section */}
      <StockReorderSection />
      
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
      
      {/* Catalogues Section */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="font-semibold text-lg">📚 Catalogues</h3>
          <button
            onClick={() => setShowUploadCatalogue(true)}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + Add Catalogue
          </button>
        </div>
        
        {catalogues.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <span className="text-4xl">📄</span>
            <p className="mt-2">No catalogues uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {catalogues.map((cat, index) => (
              <div key={cat.id} className="p-4">
                <div className="flex items-start gap-3">
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-1 pt-1">
                    <button
                      onClick={() => handleMoveCatalogue(index, 'up')}
                      disabled={index === 0}
                      className={`w-6 h-6 flex items-center justify-center rounded text-sm ${
                        index === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMoveCatalogue(index, 'down')}
                      disabled={index === catalogues.length - 1}
                      className={`w-6 h-6 flex items-center justify-center rounded text-sm ${
                        index === catalogues.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📕</span>
                      <span className="font-medium">{cat.name}</span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {cat.brand} • {cat.size_mb}MB
                    </div>
                    {cat.description && (
                      <div className="text-xs text-gray-400 mt-1">{cat.description}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      Updated: {cat.updated} {cat.uploaded_by && `by ${cat.uploaded_by}`}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingCatalogue(cat)}
                      className="text-blue-600 text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteCatalogue(cat.id)}
                      className="text-red-600 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Add Catalogue Modal */}
      {showUploadCatalogue && (
        <CatalogueUploadModal
          availableBrands={availableBrands}
          onSave={(data) => handleSaveCatalogue(data, false)}
          onClose={() => setShowUploadCatalogue(false)}
        />
      )}
      
      {/* Edit Catalogue Modal */}
      {editingCatalogue && (
        <CatalogueUploadModal
          availableBrands={availableBrands}
          catalogue={editingCatalogue}
          onSave={(data) => handleSaveCatalogue(data, true)}
          onClose={() => setEditingCatalogue(null)}
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

function CatalogueUploadModal({ availableBrands, catalogue, onSave, onClose }) {
  const isEditing = !!catalogue
  const [url, setUrl] = useState(catalogue?.url || '')
  const [brand, setBrand] = useState(catalogue?.brand || '')
  const [name, setName] = useState(catalogue?.name || '')
  const [description, setDescription] = useState(catalogue?.description || '')
  const [sizeMb, setSizeMb] = useState(catalogue?.size_mb?.toString() || '')
  const [saving, setSaving] = useState(false)
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!url || !brand || !name) {
      alert('Please enter a URL, select a brand, and enter a name')
      return
    }
    
    setSaving(true)
    const data = { url, brand, name, description, size_mb: parseFloat(sizeMb) || 0 }
    if (isEditing) {
      data.id = catalogue.id
    }
    await onSave(data)
    setSaving(false)
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-bold">{isEditing ? 'Edit Catalogue' : 'Add Catalogue'}</h2>
          <button onClick={onClose} className="text-gray-500 text-2xl">&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PDF URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.dropbox.com/...?dl=1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use Dropbox (add ?dl=1) or any direct PDF link
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">Select a brand...</option>
              {availableBrands.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Catalogue Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Räder 2026 Main Catalogue"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Full product range for 2026"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File Size (MB)</label>
            <input
              type="number"
              step="0.1"
              value={sizeMb}
              onChange={(e) => setSizeMb(e.target.value)}
              placeholder="e.g. 15.5"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          
          <button
            type="submit"
            disabled={saving || !url || !brand || !name}
            className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold disabled:bg-gray-400"
          >
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Catalogue')}
          </button>
        </form>
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
  const [showChangePin, setShowChangePin] = useState(false)
  const [pinForm, setPinForm] = useState({ current: '', new: '', confirm: '' })
  const [pinLoading, setPinLoading] = useState(false)
  const [pinError, setPinError] = useState('')
  const { requestWakeLock, releaseWakeLock } = useWakeLock()
  
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
  
  const handleChangePin = async () => {
    setPinError('')
    
    if (!pinForm.current || !pinForm.new || !pinForm.confirm) {
      setPinError('Please fill in all fields')
      return
    }
    
    if (pinForm.new !== pinForm.confirm) {
      setPinError('New PINs do not match')
      return
    }
    
    if (pinForm.new.length < 4) {
      setPinError('New PIN must be at least 4 characters')
      return
    }
    
    setPinLoading(true)
    try {
      await apiRequest('/auth/change-pin', {
        method: 'POST',
        body: JSON.stringify({
          current_pin: pinForm.current,
          new_pin: pinForm.new
        })
      })
      addToast('PIN changed successfully!', 'success')
      setShowChangePin(false)
      setPinForm({ current: '', new: '', confirm: '' })
    } catch (err) {
      setPinError(err.message || 'Failed to change PIN')
    } finally {
      setPinLoading(false)
    }
  }
  
  const handleSync = async () => {
    if (!isOnline) {
      addToast('Cannot sync while offline', 'error')
      return
    }
    
    await requestWakeLock()
    try {
      await doSync((progress) => {
        setSyncProgress(progress.message || '')
      })
      setSyncProgress('')
      addToast('Sync complete!', 'success')
    } catch (err) {
      setSyncProgress('')
      addToast('Sync failed: ' + err.message, 'error')
    } finally {
      releaseWakeLock()
    }
  }
  
  const handleDownloadImages = async () => {
    if (!isOnline) {
      addToast('Cannot download images while offline', 'error')
      return
    }
    
    setIsDownloadingImages(true)
    await requestWakeLock()
    try {
      // Get products from cache
      const products = await offlineStore.getProducts()
      if (products.length === 0) {
        addToast('Sync products first', 'error')
        setIsDownloadingImages(false)
        releaseWakeLock()
        return
      }
      
      // Download images (uses API but saves to IndexedDB for future offline use)
      const count = await syncService.syncImages(products, (progress) => {
        setSyncProgress(progress.message || '')
      })
      setSyncProgress('')
      
      // Mark as downloaded with current product count
      localStorage.setItem('dmb_images_downloaded_at', new Date().toISOString())
      localStorage.setItem('dmb_images_product_count', products.length.toString())
      
      await refreshSyncStatus()
      addToast(`Downloaded ${count} images for offline use`, 'success')
    } catch (err) {
      setSyncProgress('')
      addToast('Image download failed: ' + err.message, 'error')
    } finally {
      releaseWakeLock()
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
        {isSyncing && (
          <p className="text-xs text-gray-500 mt-1 text-center">📱 Screen will stay on during sync</p>
        )}
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
        <div className="mt-4 space-y-2">
          <button
            onClick={() => { setShowChangePin(true); setPinError(''); setPinForm({ current: '', new: '', confirm: '' }); }}
            disabled={!isOnline}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition"
          >
            🔐 Change PIN
          </button>
          <button
            onClick={logout}
            className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition"
          >
            Log Out
          </button>
        </div>
      </div>
      
      {/* Change PIN Modal */}
      {showChangePin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-bold">🔐 Change PIN</h2>
              <button onClick={() => setShowChangePin(false)} className="text-gray-500 text-2xl">&times;</button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinForm.current}
                  onChange={(e) => setPinForm({ ...pinForm, current: e.target.value })}
                  placeholder="Enter current PIN"
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinForm.new}
                  onChange={(e) => setPinForm({ ...pinForm, new: e.target.value })}
                  placeholder="Enter new PIN (min 4 characters)"
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinForm.confirm}
                  onChange={(e) => setPinForm({ ...pinForm, confirm: e.target.value })}
                  placeholder="Confirm new PIN"
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              
              {pinError && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                  {pinError}
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-gray-200 space-y-2">
              <button
                onClick={handleChangePin}
                disabled={pinLoading}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {pinLoading ? 'Changing...' : 'Change PIN'}
              </button>
              <button
                onClick={() => setShowChangePin(false)}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Clear Cache */}
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <h3 className="font-semibold text-lg mb-2 text-red-800">🗑️ Clear Cache</h3>
        <p className="text-sm text-red-700 mb-3">
          Clears all cached products, customers, and images. You'll need to sync again after restarting.
        </p>
        <button
          onClick={async () => {
            if (confirm('Clear all cached data and restart the app?')) {
              try {
                await offlineStore.clearAllData()
                addToast('Cache cleared, restarting...', 'success')
                setTimeout(() => {
                  window.location.reload()
                }, 500)
              } catch (err) {
                addToast('Failed to clear cache: ' + err.message, 'error')
              }
            }
          }}
          className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
        >
          Clear Cache & Restart
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
  const { requestWakeLock, releaseWakeLock } = useWakeLock()
  
  // Keep screen awake while app is open (prevents barcode scanner triggering passcode)
  useEffect(() => {
    requestWakeLock()
    
    // Re-acquire wake lock when tab becomes visible (it gets released when hidden)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      releaseWakeLock()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [requestWakeLock, releaseWakeLock])
  
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
        <SyncPrompts />
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
      
      <SyncPrompts />
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
