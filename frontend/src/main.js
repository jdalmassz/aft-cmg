import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { getUser, fetchMe } from './api'
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
    { path: '/', redirect: '/inicio' },
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
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }
  if (to.meta.admin && getUser()?.rol !== 'admin') return { path: '/inicio' }
  return true
})

createApp(App).use(router).mount('#app')