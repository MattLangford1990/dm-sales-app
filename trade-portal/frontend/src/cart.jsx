import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const CartCtx = createContext(null)
const STORAGE_KEY = 'tp_cart'

export function CartProvider({ children }) {
  const [lines, setLines] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  }, [lines])

  const add = (product, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === product.sku)
      if (existing) {
        return prev.map((l) =>
          l.sku === product.sku ? { ...l, quantity: l.quantity + qty } : l,
        )
      }
      return [
        ...prev,
        {
          sku: product.sku,
          name: product.name,
          brand: product.brand,
          unit_price: product.rate,
          quantity: qty,
        },
      ]
    })
  }

  const setQty = (sku, qty) => {
    setLines((prev) =>
      prev
        .map((l) => (l.sku === sku ? { ...l, quantity: Math.max(0, qty) } : l))
        .filter((l) => l.quantity > 0),
    )
  }

  const remove = (sku) => setLines((prev) => prev.filter((l) => l.sku !== sku))
  const clear = () => setLines([])

  const { count, subtotal } = useMemo(() => {
    return lines.reduce(
      (acc, l) => ({
        count: acc.count + l.quantity,
        subtotal: acc.subtotal + l.unit_price * l.quantity,
      }),
      { count: 0, subtotal: 0 },
    )
  }, [lines])

  return (
    <CartCtx.Provider value={{ lines, add, setQty, remove, clear, count, subtotal }}>
      {children}
    </CartCtx.Provider>
  )
}

export const useCart = () => useContext(CartCtx)
