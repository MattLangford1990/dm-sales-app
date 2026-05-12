const TOKEN_KEY = 'tp_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let payload
  if (form) {
    payload = new URLSearchParams(form)
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`/api${path}`, { method, headers, body: payload })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch {
      // ignore
    }
    const err = new Error(typeof detail === 'string' ? detail : 'Request failed')
    err.status = res.status
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  login: (email, password) =>
    request('/auth/login', { method: 'POST', form: { username: email, password } }),
  signup: (data) => request('/auth/signup', { method: 'POST', body: data }),
  me: () => request('/auth/me'),

  brands: () => request('/brands'),
  products: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/products${qs ? `?${qs}` : ''}`)
  },
  product: (sku) => request(`/products/${encodeURIComponent(sku)}`),

  createOrder: (lines, notes) =>
    request('/orders', { method: 'POST', body: { lines, notes } }),
  orders: () => request('/orders'),
  order: (id) => request(`/orders/${id}`),
}
