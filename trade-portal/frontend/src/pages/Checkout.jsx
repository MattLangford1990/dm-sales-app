import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useCart } from '../cart.jsx'
import { gbp } from '../format.js'

export default function Checkout() {
  const { account } = useAuth()
  const { lines, subtotal, clear } = useCart()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  if (lines.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-600">Your cart is empty.</p>
        <Link className="text-brand-700 hover:underline" to="/">Back to catalogue</Link>
      </div>
    )
  }

  const placeOrder = async () => {
    setBusy(true)
    setError('')
    try {
      const order = await api.createOrder(
        lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
        notes || null,
      )
      clear()
      navigate(`/account/orders/${order.id}?placed=1`)
    } catch (err) {
      setError(err.message || 'Could not place order')
    } finally {
      setBusy(false)
    }
  }

  const deliveryLine = [
    account?.address_line1,
    account?.address_line2,
    account?.town,
    account?.postcode,
    account?.country,
  ].filter(Boolean).join(', ')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link to="/cart" className="text-sm text-gray-500 hover:text-ink-900 inline-block mb-3">
        ← Back to cart
      </Link>
      <h1 className="text-2xl font-bold text-ink-900 mb-5">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-semibold text-ink-900 mb-3">Delivery to</h2>
            <p className="text-ink-900 font-medium">{account?.company_name}</p>
            <p className="text-sm text-gray-600">{account?.contact_name}</p>
            <p className="text-sm text-gray-600">
              {deliveryLine || <span className="italic text-gray-400">No address on file — add one in your account</span>}
            </p>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-semibold text-ink-900 mb-3">Order notes (optional)</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Delivery instructions, PO reference, etc."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </section>
        </div>

        <aside className="bg-white border border-gray-200 rounded-2xl p-5 h-fit">
          <h2 className="font-semibold text-ink-900 mb-3">Summary</h2>
          <ul className="divide-y text-sm">
            {lines.map((l) => (
              <li key={l.sku} className="py-2 flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">{l.name}</span>
                  <span className="text-xs text-gray-500">{l.quantity} × {gbp(l.unit_price)}</span>
                </span>
                <span className="font-medium whitespace-nowrap">{gbp(l.unit_price * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t mt-3 pt-3 flex justify-between font-bold text-lg">
            <span>Total (ex. VAT)</span>
            <span>{gbp(subtotal)}</span>
          </div>

          {error && (
            <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={placeOrder}
            disabled={busy}
            className="w-full mt-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-3 rounded-lg"
          >
            {busy ? 'Placing order…' : 'Place order'}
          </button>
          <p className="text-xs text-gray-500 mt-2 text-center">
            You'll receive a confirmation email once dispatched.
          </p>
        </aside>
      </div>
    </div>
  )
}
