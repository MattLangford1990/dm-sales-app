import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

export default function Catalogue() {
  const [brands, setBrands] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.brands(), api.products()])
      .then(([brandList, products]) => {
        setBrands(brandList)
        const acc = {}
        for (const p of products) {
          if (!acc[p.brand]) acc[p.brand] = { total: 0, inStock: 0 }
          acc[p.brand].total += 1
          if (p.stock_on_hand > 0) acc[p.brand].inStock += 1
        }
        setCounts(acc)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading catalogue…</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-ink-900">Our brands</h1>
        <p className="text-gray-600">Choose a brand to browse trade-priced products.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {brands.map((brand) => {
          const c = counts[brand.id] || { total: 0, inStock: 0 }
          return (
            <Link
              key={brand.id}
              to={`/brand/${brand.id}`}
              className="rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition border border-gray-200 bg-white active:scale-[0.99]"
            >
              <div
                className={`bg-gradient-to-br ${brand.accent} h-32 p-5 text-white flex flex-col justify-end`}
              >
                <p className="text-xs uppercase tracking-wider opacity-90">{brand.origin}</p>
                <h2 className="text-2xl font-bold drop-shadow-sm">{brand.name}</h2>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-700">{brand.tagline}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                  <span>
                    <strong className="text-ink-900">{c.total}</strong> SKUs
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    <strong className="text-green-700">{c.inStock}</strong> in stock
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
