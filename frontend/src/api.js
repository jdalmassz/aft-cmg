import { ref } from 'vue'

let TOKEN = localStorage.getItem('aft_token') || null

// El usuario va en una ref, no en una variable suelta. Con el SSO no hay login
// en la pantalla: el guard llama a /api/me y eso pasa DESPUÉS del primer render.
// Si getUser() devolviera una variable normal, el computed del lateral se
// evaluaría una vez con null y se quedaría cacheado: el pie mostraba «Usuario»
// sin nombre y sin cambiar nunca.
const USER = ref(JSON.parse(localStorage.getItem('aft_user') || 'null'))

function setSession(token, user) {
  TOKEN = token
  USER.value = user || null
  if (token) localStorage.setItem('aft_token', token)
  else localStorage.removeItem('aft_token')
  if (user) localStorage.setItem('aft_user', JSON.stringify(user))
  else localStorage.removeItem('aft_user')
}

function clearSession() {
  setSession(null, null)
}

function getToken() {
  return TOKEN
}

function getUser() {
  return USER.value
}

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (res.status === 401) {
    clearSession()
    window.location.href = '/login'
    throw new Error('Sesión expirada')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error en la petición')
  return data
}

const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  download: async (url, filename) => {
    const headers = {}
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
    const res = await fetch(url, { headers })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'No se pudo descargar el archivo')
    }
    const blob = await res.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename || 'archivo.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 5000)
  }
}

const fetchMe = () => api.get('/api/me').then((data) => {
  // El token del SSO vive en cookie httpOnly (no visible para JS); aquí solo
  // guardamos quién es, para que el router no tenga que preguntar cada vez.
  if (data && data.user) setSession(null, data.user)
  return data
})
// El token del SSO vive en cookie httpOnly, que el frontend no puede borrar;
// el servidor la borra en /api/auth/logout (sin exigir token: si la sesión ya
// expiró, la cookie tendría que limpiarse igual).
const logout = () => request('POST', '/api/auth/logout').then(clearSession)

function formatMoneda(n) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('es-CU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export { api, fetchMe, logout, setSession, clearSession, getUser, getToken, formatMoneda }