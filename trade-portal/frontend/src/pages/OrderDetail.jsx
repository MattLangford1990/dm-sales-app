import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { gbp } from '../format.js'

export default function OrderDetail() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchParams] = useSearchParams()
  const justPlaced = searchParams.get('placed') === '1'

  useEffect(() => {
    api.order(id)
      .then(setOrder)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>
  if (!order) {
    return (
      <div className="p-8 text-center text-gray-500">
        Order not found. <Link className="text-brand-700 hover:underline" to="/account">Back to account</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link to="/account" className="text-sm text-gray-500 hover:text-ink-900 inline-block mb-3">
        ← Account
      </Link>

      {justPlaced && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-800 rounded-2xl p-4">
          <p className="font-semibold">Order placed.</p>
          <p className="text-sm">We'll send a confirmation email shortly.</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500">Order reference</p>
          <p className="font-mono text-lg font-semibold">{order.reference}</p>
          <p className="text-sm text-gray-600 mt-1">
            Placed {new Date(order.created_at).toLocaleString('en-GB')}
          </p>
        </div>
        <span className="text-xs font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-700 capitalize">
          {order.status}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2">Product</th>
              <th className="text-right px-4 py-2">Unit price</th>
              <th className="text-right px-4 py-2">Qty</th>
              <th className="text-right px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <p className="font-mono text-xs text-gray-500">{l.sku}</p>
                  <p className="font-medium">{l.name}</p>
                </td>
                <td className="text-right px-4 py-3">{gbp(l.unit_price)}</td>
                <td className="text-right px-4 py-3">{l.quantity}</td>
                <td className="text-right px-4 py-3 font-semibold">{gbp(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={3} className="text-right px-4 py-3 font-semibold">Subtotal (ex. VAT)</td>
              <td className="text-right px-4 py-3 font-bold">{gbp(order.subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {order.notes && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mt-4">
          <h3 className="font-semibold text-ink-900 mb-2">Order notes</h3>
          <p className="text-gray-700 whitespace-pre-wrap">{order.notes}</p>
        </div>
      )}
    </div>
  )
}
