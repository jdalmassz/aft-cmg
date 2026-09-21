import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { getUser, fetchMe } from './api'
import './style.css'

const Login = () => import('./views/LoginView.vue')
const Dashboard = () => import('./views/DashboardView.vue')
const Activos = () => import('./views/ActivosView.vue')
const Usuarios = () => import('./views/UsuariosView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/inicio' },
    { path: '/login', component: Login },
    { path: '/inicio', component: Dashboard, meta: { auth: true } },
    { path: '/activos', component: Activos, meta: { auth: true } },
    { path: '/usuarios', component: Usuarios, meta: { auth: true, admin: true } },
    { path: '/:pathMatch(.*)*', redirect: '/inicio' }
  ]
})

router.beforeEach(async (to) => {
  if (!to.meta.auth) return true
  if (getUser()) return true
  try {
    await fetchMe()
    return true
  } catch {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})

createApp(App).use(router).mount('#app')