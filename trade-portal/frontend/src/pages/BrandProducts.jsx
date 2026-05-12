import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { useCart } from '../cart.jsx'
import { gbp, stockLabel } from '../format.js'

export default function BrandProducts() {
  const { brandId } = useParams()
  const { add } = useCart()
  const [brand, setBrand] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.brands(), api.products({ brand: brandId })])
      .then(([brands, items]) => {
        setBrand(brands.find((b) => b.id === brandId))
        setProducts(items)
      })
      .finally(() => setLoading(false))
  }, [brandId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (inStockOnly && p.stock_on_hand <= 0) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    })
  }, [products, search, inStockOnly])

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading…</div>
  }
  if (!brand) {
    return (
      <div className="p-8 text-center text-gray-500">
        Brand not found. <Link className="text-brand-700 hover:underline" to="/">Back to catalogue</Link>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <Link to="/" className="text-sm text-gray-500 hover:text-ink-900 inline-block mb-3">
        ← Catalogue
      </Link>

      <div className={`bg-gradient-to-br ${brand.accent} rounded-2xl p-5 text-white mb-5`}>
        <p className="text-xs uppercase tracking-wider opacity-90">{brand.origin}</p>
        <h1 className="text-3xl font-bold">{brand.name}</h1>
        <p className="opacity-90 mt-1">{brand.tagline}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU"
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
        />
        <label className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-xl cursor-pointer select-none">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
            className="accent-brand-600"
          />
          <span className="text-sm text-gray-700">In stock only</span>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 py-16">
          <p className="text-4xl mb-2">📦</p>
          <p>No products match.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => {
            const badge = stockLabel(p.stock_on_hand)
            return (
              <article
                key={p.item_id}
                className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2 hover:border-brand-600 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-mono">{p.sku}</p>
                    <Link
                      to={`/product/${p.sku}`}
                      className="font-semibold text-ink-900 leading-snug hover:text-brand-700"
                    >
                      {p.name}
                    </Link>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${badge.cls}`}>
                    {badge.text}
                  </span>
                </div>
                <div className="flex items-end justify-between mt-1">
                  <div>
                    <p className="text-xs text-gray-500">Trade price</p>
                    <p className="text-xl font-bold text-ink-900">{gbp(p.rate)}</p>
                  </div>
                  {p.pack_qty > 1 && (
                    <span className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-md">
                      Pack of {p.pack_qty}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => add(p, 1)}
                  disabled={p.stock_on_hand <= 0}
                  className="mt-1 w-full bg-brand-600 hover:bg-brand-700 disabled:bg-gray-200 disabled:text-gray-500 text-white text-sm font-medium py-2 rounded-lg"
                >
                  {p.stock_on_hand <= 0 ? 'Out of stock' : 'Add to cart'}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
