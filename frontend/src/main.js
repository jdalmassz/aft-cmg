import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { getUser, fetchMe } from './api'
import { getCatalogo } from './catalogo'
import './style.css'

const Login = () => import('./views/LoginView.vue')
const Dashboard = () => import('./views/DashboardView.vue')
const Activos = () => import('./views/ActivosView.vue')
const Utiles = () => import('./views/UtilesView.vue')
const Responsables = () => import('./views/ResponsablesView.vue')
const Areas = () => import('./views/AreasView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // La raíz conserva la query: por aquí entran los `?sso=…` que devuelve el
    // backend cuando la ida o el canje fallan, y si se perdieran aquí nadie
    // vería nunca el motivo en la pantalla de login.
    { path: '/', redirect: (to) => ({ path: '/inicio', query: to.query }) },
    { path: '/login', component: Login },
    { path: '/inicio', component: Dashboard, meta: { auth: true } },
    { path: '/activos', component: Activos, meta: { auth: true } },
    { path: '/utiles', component: Utiles, meta: { auth: true } },
    { path: '/responsables', component: Responsables, meta: { auth: true, admin: true } },
    { path: '/areas', component: Areas, meta: { auth: true, admin: true } },
    { path: '/:pathMatch(.*)*', redirect: '/inicio' }
  ]
})

router.beforeEach(async (to) => {
  if (!to.meta.auth) return true
  if (!getUser()) {
    try {
      await fetchMe()
    } catch {
      // El motivo del fallo de Accesos llega como ?sso=… en la URL de origen:
      // si se descartara aquí, quien entra se quedaría en la pantalla de login
      // sin ninguna pista de lo que ha pasado.
      return { path: '/login', query: { ...to.query, redirect: to.fullPath } }
    }
  }
  if (to.meta.admin && getUser()?.rol !== 'admin') return { path: '/inicio' }
  return true
})

// El catálogo lo necesitan casi todas las pantallas: se pide mientras el router
// resuelve la ruta, así la primera pantalla ya lo tiene cuando monta y no hay
// que esperar a que ella lo pida (en la pantalla de login no se pide: allí no
// hay sesión todavía y el 401 mandaría a /login otra vez).
if (getUser()) getCatalogo().catch(() => {})

createApp(App).use(router).mount('#app')