import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { useCart } from '../cart.jsx'

const navClass = ({ isActive }) =>
  `text-sm font-medium transition ${
    isActive ? 'text-brand-600' : 'text-gray-600 hover:text-ink-900'
  }`

export default function Layout() {
  const { account, logout } = useAuth()
  const { count } = useCart()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 text-white grid place-items-center font-bold">
              DM
            </div>
            <div>
              <p className="font-semibold leading-tight text-ink-900">DM Brands</p>
              <p className="text-xs text-gray-500 leading-tight">Trade Portal</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <NavLink to="/" end className={navClass}>Catalogue</NavLink>
            <NavLink to="/account" className={navClass}>Orders</NavLink>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/cart"
              className="relative px-3 py-2 rounded-lg border border-gray-300 hover:border-brand-600 text-sm font-medium text-gray-700 hover:text-brand-700"
            >
              Cart
              {count > 0 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-brand-600 text-white text-xs font-semibold">
                  {count}
                </span>
              )}
            </Link>
            <div className="hidden sm:block text-right text-xs leading-tight">
              <p className="font-medium text-ink-900 truncate max-w-[160px]">
                {account?.company_name}
              </p>
              <button
                onClick={handleLogout}
                className="text-gray-500 hover:text-red-600 underline-offset-2 hover:underline"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400">
        DM Brands Trade Portal · Stock and pricing reflect Zoho Inventory data.
      </footer>
    </div>
  )
}
