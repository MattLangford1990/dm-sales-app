import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../cart.jsx'
import { gbp } from '../format.js'

export default function Cart() {
  const { lines, setQty, remove, subtotal, clear } = useCart()
  const navigate = useNavigate()

  if (lines.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-5xl mb-3">🛒</p>
        <h1 className="text-2xl font-bold text-ink-900 mb-2">Your cart is empty</h1>
        <p className="text-gray-600 mb-6">Browse the catalogue to add products.</p>
        <Link
          to="/"
          className="inline-block bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg"
        >
          Browse catalogue
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-ink-900">Your cart</h1>
        <button
          onClick={clear}
          className="text-sm text-red-600 hover:underline"
        >
          Clear cart
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl divide-y">
        {lines.map((l) => (
          <div key={l.sku} className="p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 font-mono">{l.sku}</p>
              <Link
                to={`/product/${l.sku}`}
                className="font-semibold text-ink-900 hover:text-brand-700"
              >
                {l.name}
              </Link>
              <p className="text-sm text-gray-600">{gbp(l.unit_price)} each</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQty(l.sku, l.quantity - 1)}
                className="w-9 h-9 rounded-lg border border-gray-300 text-lg"
                aria-label="Decrease"
              >
                −
              </button>
              <input
                type="number"
                value={l.quantity}
                onChange={(e) => setQty(l.sku, parseInt(e.target.value) || 0)}
                className="w-14 text-center px-1 py-2 border border-gray-300 rounded-lg"
                min={0}
              />
              <button
                onClick={() => setQty(l.sku, l.quantity + 1)}
                className="w-9 h-9 rounded-lg border border-gray-300 text-lg"
                aria-label="Increase"
              >
                +
              </button>
            </div>
            <div className="w-24 text-right font-semibold text-ink-900">
              {gbp(l.unit_price * l.quantity)}
            </div>
            <button
              onClick={() => remove(l.sku)}
              className="text-gray-400 hover:text-red-600 text-xl"
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="text-right sm:text-left">
          <p className="text-sm text-gray-600">Subtotal (ex. VAT)</p>
          <p className="text-3xl font-bold text-ink-900">{gbp(subtotal)}</p>
        </div>
        <button
          onClick={() => navigate('/checkout')}
          className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-6 py-3 rounded-lg"
        >
          Proceed to checkout →
        </button>
      </div>
    </div>
  )
}
