import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

const Field = ({ label, ...props }) => (
  <label className="block">
    <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
    <input
      {...props}
      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
    />
  </label>
)

export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '',
    password: '',
    company_name: '',
    contact_name: '',
    phone: '',
    vat_number: '',
    address_line1: '',
    address_line2: '',
    town: '',
    postcode: '',
    country: 'United Kingdom',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signup(form)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Signup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-brand-50 to-white p-4 py-10">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-ink-900">Apply for trade access</h1>
        <p className="text-sm text-gray-600 mb-6">
          Fill in your business details to create a trade account.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Email"
              type="email"
              required
              value={form.email}
              onChange={update('email')}
            />
            <Field
              label="Password (min 8 chars)"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={update('password')}
            />
            <Field
              label="Company name"
              required
              value={form.company_name}
              onChange={update('company_name')}
            />
            <Field
              label="Contact name"
              required
              value={form.contact_name}
              onChange={update('contact_name')}
            />
            <Field
              label="Phone"
              value={form.phone}
              onChange={update('phone')}
            />
            <Field
              label="VAT number"
              value={form.vat_number}
              onChange={update('vat_number')}
            />
            <Field
              label="Address line 1"
              value={form.address_line1}
              onChange={update('address_line1')}
            />
            <Field
              label="Address line 2"
              value={form.address_line2}
              onChange={update('address_line2')}
            />
            <Field label="Town" value={form.town} onChange={update('town')} />
            <Field label="Postcode" value={form.postcode} onChange={update('postcode')} />
            <Field label="Country" value={form.country} onChange={update('country')} />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-60"
          >
            {busy ? 'Creating account…' : 'Create trade account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-center text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-700 font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
