import { createContext, useContext, useEffect, useState } from 'react'
import { api, clearToken, getToken, setToken } from './api.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api.me()
      .then(setAccount)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const { access_token, account: acc } = await api.login(email, password)
    setToken(access_token)
    setAccount(acc)
    return acc
  }

  const signup = async (data) => {
    const { access_token, account: acc } = await api.signup(data)
    setToken(access_token)
    setAccount(acc)
    return acc
  }

  const logout = () => {
    clearToken()
    setAccount(null)
  }

  return (
    <AuthCtx.Provider value={{ account, loading, login, signup, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
