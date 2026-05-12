import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { gbp } from '../format.js'

export default function Account() {
  const { account } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.orders()
      .then(setOrders)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-ink-900 mb-1">Your account</h1>
      <p className="text-gray-600 mb-6">{account?.company_name} · {account?.email}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <aside className="bg-white border border-gray-200 rounded-2xl p-5 h-fit">
          <h2 className="font-semibold text-ink-900 mb-3">Account details</h2>
          <dl className="text-sm space-y-2">
            <div>
              <dt className="text-gray-500">Contact</dt>
              <dd className="font-medium">{account?.contact_name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Phone</dt>
              <dd className="font-medium">{account?.phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">VAT number</dt>
              <dd className="font-medium">{account?.vat_number || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Address</dt>
              <dd className="font-medium leading-snug">
                {[
                  account?.address_line1,
                  account?.address_line2,
                  account?.town,
                  account?.postcode,
                  account?.country,
                ]
                  .filter(Boolean)
                  .map((line, i) => (
                    <span key={i} className="block">{line}</span>
                  )) || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd>
                <span className="inline-block text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700 capitalize">
                  {account?.status}
                </span>
              </dd>
            </div>
          </dl>
        </aside>

        <section className="lg:col-span-2">
          <h2 className="font-semibold text-ink-900 mb-3">Order history</h2>
          {loading ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-500">
              Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-500">
              <p>No orders yet.</p>
              <Link to="/" className="text-brand-700 hover:underline">Browse catalogue</Link>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl divide-y">
              {orders.map((o) => (
                <Link
                  key={o.id}
                  to={`/account/orders/${o.id}`}
                  className="p-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div>
                    <p className="font-mono text-sm text-gray-500">{o.reference}</p>
                    <p className="font-medium">
                      {o.lines.length} {o.lines.length === 1 ? 'line' : 'lines'} ·{' '}
                      <span className="text-gray-600">{new Date(o.created_at).toLocaleDateString('en-GB')}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{gbp(o.subtotal)}</p>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">
                      {o.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
