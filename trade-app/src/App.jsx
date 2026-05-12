import { useMemo, useState } from 'react'
import { BRANDS, getBrand } from './data/brands.js'
import { getProductsByBrand, getBrandStats } from './data/products.js'

const gbp = (n) => `£${n.toFixed(2)}`

function Header({ onHome, brand }) {
  return (
    <header className="bg-plum-900 text-white">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
        {brand && (
          <button
            onClick={onHome}
            aria-label="Back to brands"
            className="text-plum-100 hover:text-white text-2xl leading-none"
          >
            ←
          </button>
        )}
        <button onClick={onHome} className="text-left">
          <h1 className="text-xl font-bold tracking-tight">DM Brands Trade</h1>
          <p className="text-xs text-plum-200">
            {brand ? brand.tagline : 'Wholesale catalogue'}
          </p>
        </button>
      </div>
    </header>
  )
}

function BrandGrid({ onSelect }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Our brands</h2>
        <p className="text-sm text-gray-600">
          Tap a brand to view live stock and trade prices.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BRANDS.map((brand) => {
          const stats = getBrandStats(brand.id)
          return (
            <button
              key={brand.id}
              onClick={() => onSelect(brand.id)}
              className="text-left rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition border border-gray-200 bg-white active:scale-[0.99]"
            >
              <div className={`bg-gradient-to-br ${brand.accent} h-28 p-4 text-white flex flex-col justify-end`}>
                <p className="text-xs uppercase tracking-wider opacity-90">{brand.origin}</p>
                <h3 className="text-2xl font-bold drop-shadow-sm">{brand.name}</h3>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-700">{brand.tagline}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                  <span>
                    <strong className="text-gray-900">{stats.total}</strong> SKUs
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    <strong className="text-green-700">{stats.inStock}</strong> in stock
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </main>
  )
}

function StockBadge({ qty }) {
  if (qty <= 0) {
    return (
      <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">
        Out of stock
      </span>
    )
  }
  if (qty < 20) {
    return (
      <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-800">
        Low · {qty}
      </span>
    )
  }
  return (
    <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">
      In stock · {qty}
    </span>
  )
}

function ProductList({ brand }) {
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)

  const products = useMemo(() => {
    const all = getProductsByBrand(brand.id)
    const q = search.trim().toLowerCase()
    return all.filter((p) => {
      if (inStockOnly && p.stock_on_hand <= 0) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      )
    })
  }, [brand.id, search, inStockOnly])

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className={`bg-gradient-to-br ${brand.accent} rounded-2xl p-5 text-white mb-5`}>
        <p className="text-xs uppercase tracking-wider opacity-90">{brand.origin}</p>
        <h2 className="text-3xl font-bold">{brand.name}</h2>
        <p className="opacity-90 mt-1">{brand.tagline}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU"
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-plum-600 focus:border-transparent outline-none"
        />
        <label className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-xl cursor-pointer select-none">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
            className="accent-plum-700"
          />
          <span className="text-sm text-gray-700">In stock only</span>
        </label>
      </div>

      {products.length === 0 ? (
        <div className="text-center text-gray-500 py-16">
          <p className="text-4xl mb-2">📦</p>
          <p>No products match.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p) => (
            <article
              key={p.item_id}
              className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2 hover:border-plum-600 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-gray-500 font-mono">{p.sku}</p>
                  <h3 className="font-semibold text-gray-900 leading-snug">{p.name}</h3>
                </div>
                <StockBadge qty={p.stock_on_hand} />
              </div>
              <div className="flex items-end justify-between mt-1">
                <div>
                  <p className="text-xs text-gray-500">Trade price</p>
                  <p className="text-xl font-bold text-plum-800">{gbp(p.rate)}</p>
                </div>
                {p.pack_qty > 1 && (
                  <span className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-md">
                    Pack of {p.pack_qty}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-gray-400 mt-6">
        Showing {products.length} of {getProductsByBrand(brand.id).length} products
      </p>
    </main>
  )
}

export default function App() {
  const [brandId, setBrandId] = useState(null)
  const brand = brandId ? getBrand(brandId) : null

  return (
    <div className="min-h-full">
      <Header brand={brand} onHome={() => setBrandId(null)} />
      {brand ? <ProductList brand={brand} /> : <BrandGrid onSelect={setBrandId} />}
      <footer className="max-w-6xl mx-auto px-4 py-6 text-center text-xs text-gray-400">
        Stock and pricing shown reflect Zoho Inventory data.
      </footer>
    </div>
  )
}
