<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getUser, clearSession } from './api'
import AppIcon from './components/AppIcon.vue'

const route = useRoute()
const router = useRouter()

const user = computed(() => getUser())
const isAuthPage = computed(() => route.path === '/login')

function logout() {
  clearSession()
  router.push('/login')
}
</script>

<template>
  <div v-if="isAuthPage">
    <router-view />
  </div>
  <div v-else class="layout">
    <aside class="side">
      <div class="brand">
        <div class="logo"><AppIcon name="box" :size="30" /></div>
        <div>
          <div class="brand-name">AFT Camagüey</div>
          <div class="brand-sub">Logística de Activos</div>
        </div>
      </div>
      <nav>
        <router-link to="/inicio" class="nav-link" active-class="act"><AppIcon name="chart" :size="17" /> Dashboard</router-link>
        <router-link to="/activos" class="nav-link" active-class="act"><AppIcon name="box" :size="17" /> Inventario</router-link>
        <router-link v-if="user?.rol === 'admin'" to="/usuarios" class="nav-link" active-class="act"><AppIcon name="users" :size="17" /> Usuarios</router-link>
      </nav>
      <div class="side-foot">
        <div class="who">{{ user?.nombre || user?.username }}</div>
        <div class="role">{{ user?.rol === 'admin' ? 'Administrador' : 'Usuario' }}</div>
        <button class="btn sec sm" @click="logout"><AppIcon name="log-out" :size="15" /> Salir</button>
      </div>
    </aside>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; min-height: 100vh; }
.side { width: 240px; background: #0f172a; color: #fff; display: flex; flex-direction: column; padding: 18px 14px; position: sticky; top: 0; height: 100vh; }
.brand { display: flex; align-items: center; gap: 10px; padding: 6px 4px 18px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 16px; }
.logo { color: #60a5fa; display: flex; }
.brand-name { font-weight: 800; font-size: 15px; }
.brand-sub { font-size: 11px; color: #94a3b8; }
nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.nav-link { color: #cbd5e1; padding: 9px 12px; border-radius: 8px; font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 9px; }
.nav-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
.nav-link.act { background: var(--primary); color: #fff; }
.side-foot { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; }
.who { font-weight: 700; font-size: 13px; }
.role { font-size: 11px; color: #94a3b8; margin-bottom: 8px; }
.side-foot .btn { width: 100%; justify-content: center; }
.content { flex: 1; padding: 24px 28px; overflow-x: hidden; }
</style>