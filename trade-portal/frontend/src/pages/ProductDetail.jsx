import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { useCart } from '../cart.jsx'
import { gbp, stockLabel } from '../format.js'

export default function ProductDetail() {
  const { sku } = useParams()
  const { add } = useCart()
  const navigate = useNavigate()
  const [product, setProduct] = useState(null)
  const [brand, setBrand] = useState(null)
  const [qty, setQty] = useState(1)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setLoading(true)
    api
      .product(sku)
      .then(async (p) => {
        setProduct(p)
        const brands = await api.brands()
        setBrand(brands.find((b) => b.id === p.brand))
      })
      .catch((err) => {
        if (err.status === 404) setNotFound(true)
      })
      .finally(() => setLoading(false))
  }, [sku])

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>
  if (notFound) {
    return (
      <div className="p-8 text-center text-gray-500">
        Product not found. <Link className="text-brand-700 hover:underline" to="/">Back to catalogue</Link>
      </div>
    )
  }
  if (!product) return null

  const badge = stockLabel(product.stock_on_hand)
  const outOfStock = product.stock_on_hand <= 0

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link
        to={`/brand/${product.brand}`}
        className="text-sm text-gray-500 hover:text-ink-900 inline-block mb-3"
      >
        ← {brand?.name || 'Brand'}
      </Link>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className={`bg-gradient-to-br ${brand?.accent || 'from-gray-300 to-gray-500'} h-32 p-5 text-white flex flex-col justify-end`}>
          <p className="text-xs uppercase tracking-wider opacity-90">{brand?.name}</p>
          <h1 className="text-2xl font-bold drop-shadow-sm">{product.name}</h1>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-gray-500 font-mono mb-2">SKU · {product.sku}</p>
            <p className="text-gray-700 mb-4">{product.description}</p>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge.cls}`}>
              {badge.text}
            </span>
            {product.pack_qty > 1 && (
              <span className="ml-2 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-md">
                Pack of {product.pack_qty}
              </span>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-500">Trade price</p>
            <p className="text-3xl font-bold text-ink-900 mb-4">{gbp(product.rate)}</p>

            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-10 h-10 rounded-lg bg-white border border-gray-300 text-xl"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-center px-2 py-2 border border-gray-300 rounded-lg"
                min={1}
              />
              <button
                onClick={() => setQty((q) => q + 1)}
                className="w-10 h-10 rounded-lg bg-white border border-gray-300 text-xl"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>

            <button
              disabled={outOfStock}
              onClick={() => {
                add(product, qty)
                navigate('/cart')
              }}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-gray-200 disabled:text-gray-500 text-white font-medium py-2.5 rounded-lg"
            >
              {outOfStock ? 'Out of stock' : `Add ${qty} to cart`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
