import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Signup from './pages/Signup.jsx'
import Catalogue from './pages/Catalogue.jsx'
import BrandProducts from './pages/BrandProducts.jsx'
import ProductDetail from './pages/ProductDetail.jsx'
import Cart from './pages/Cart.jsx'
import Checkout from './pages/Checkout.jsx'
import Account from './pages/Account.jsx'
import OrderDetail from './pages/OrderDetail.jsx'

function RequireAuth({ children }) {
  const { account, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Loading…
      </div>
    )
  }
  if (!account) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Catalogue />} />
        <Route path="/brand/:brandId" element={<BrandProducts />} />
        <Route path="/product/:sku" element={<ProductDetail />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/account" element={<Account />} />
        <Route path="/account/orders/:id" element={<OrderDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
