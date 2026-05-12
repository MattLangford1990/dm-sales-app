import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-brand-50 to-white p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand-600 text-white grid place-items-center font-bold text-lg mb-3">
            DM
          </div>
          <h1 className="text-2xl font-bold text-ink-900">Trade portal</h1>
          <p className="text-sm text-gray-600">Sign in to view trade pricing and place orders.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            />
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
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-sm text-center text-gray-600">
          No account yet?{' '}
          <Link to="/signup" className="text-brand-700 font-medium hover:underline">
            Apply for trade access
          </Link>
        </p>
      </div>
    </div>
  )
}
