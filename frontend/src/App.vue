<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getUser, clearSession } from './api'
import AppIcon from './components/AppIcon.vue'
import Toasts from './components/Toasts.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()

const user = computed(() => getUser())
const isAuthPage = computed(() => route.path === '/login')
const menuOpen = ref(false)
const colapsado = ref(localStorage.getItem('aft_sidebar') === '1')

const pageTitle = computed(() => {
  const t = { '/inicio': 'Dashboard', '/activos': 'Inventario', '/usuarios': 'Usuarios' }
  return t[route.path] || 'AFT Camagüey'
})

function toggleColapsado() {
  colapsado.value = !colapsado.value
  localStorage.setItem('aft_sidebar', colapsado.value ? '1' : '0')
}

function logout() {
  clearSession()
  router.push('/login')
}
</script>

<template>
  <div>
    <div v-if="isAuthPage">
      <router-view />
    </div>
    <div v-else class="layout">
      <div v-if="menuOpen" class="backdrop" @click="menuOpen = false"></div>
      <aside class="side" :class="{ open: menuOpen, collapsed: colapsado }">
        <div class="brand">
          <div class="logo"><AppIcon name="box" :size="30" /></div>
          <div v-if="!colapsado" class="brand-txt">
            <div class="brand-name">AFT Camagüey</div>
            <div class="brand-sub">Logística de Activos</div>
          </div>
        </div>
        <nav>
          <router-link to="/inicio" class="nav-link" active-class="act" title="Dashboard"><AppIcon name="chart" :size="17" /> <span v-if="!colapsado" class="nl-txt">Dashboard</span></router-link>
          <router-link to="/activos" class="nav-link" active-class="act" title="Inventario"><AppIcon name="box" :size="17" /> <span v-if="!colapsado" class="nl-txt">Inventario</span></router-link>
          <router-link v-if="user?.rol === 'admin'" to="/usuarios" class="nav-link" active-class="act" title="Usuarios"><AppIcon name="users" :size="17" /> <span v-if="!colapsado" class="nl-txt">Usuarios</span></router-link>
        </nav>
        <div class="side-foot">
          <template v-if="!colapsado">
            <div class="who">{{ user?.nombre || user?.username }}</div>
            <div class="role">{{ user?.rol === 'admin' ? 'Administrador' : 'Usuario' }}</div>
          </template>
          <button class="btn sec sm" :title="colapsado ? 'Salir' : 'Salir'" @click="logout"><AppIcon name="log-out" :size="15" /> <span v-if="!colapsado" class="nl-txt">Salir</span></button>
          <button class="btn sec sm" :title="colapsado ? 'Expandir menú' : 'Contraer menú'" @click="toggleColapsado"><AppIcon name="panel" :size="15" /> <span v-if="!colapsado" class="nl-txt">Contraer menú</span></button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn sec sm hamb" @click="menuOpen = true" aria-label="Abrir menú"><AppIcon name="menu" :size="18" /></button>
          <span class="tb-title">{{ pageTitle }}</span>
        </header>
        <main class="content">
          <router-view />
        </main>
      </div>
    </div>
    <Toasts />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.layout { display: flex; min-height: 100vh; }
.side {
  width: 240px; background: #0f172a; color: #fff; display: flex; flex-direction: column;
  padding: 18px 14px; position: sticky; top: 0; height: 100vh; z-index: 700;
  transition: width 0.18s ease, padding 0.18s ease;
}
.side.collapsed { width: 66px; padding: 18px 10px; }
.brand { display: flex; align-items: center; gap: 10px; padding: 6px 4px 18px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 16px; }
.side.collapsed .brand { justify-content: center; padding: 6px 0 18px; }
.logo { color: #60a5fa; display: flex; }
.brand-txt { min-width: 0; overflow: hidden; white-space: nowrap; }
.brand-name { font-weight: 800; font-size: 15px; }
.brand-sub { font-size: 11px; color: #94a3b8; }
nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.nav-link { color: #cbd5e1; padding: 9px 12px; border-radius: 8px; font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 9px; overflow: hidden; white-space: nowrap; }
.nav-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
.nav-link.act { background: var(--primary); color: #fff; }
.side.collapsed .nav-link { justify-content: center; padding: 11px 0; }
.side-foot { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.side-foot .btn { width: 100%; justify-content: center; }
.side.collapsed .btn { padding: 7px 0; }
.who { font-weight: 700; font-size: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.role { font-size: 11px; color: #94a3b8; margin-bottom: 8px; }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  display: none; align-items: center; gap: 12px; padding: 12px 16px;
  background: #0f172a; color: #fff; position: sticky; top: 0; z-index: 600;
}
.tb-title { font-weight: 800; font-size: 15px; }
.backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 650; }
.content { flex: 1; padding: 24px 28px; overflow-x: hidden; }

@media (max-width: 820px) {
  .side { position: fixed; left: 0; top: 0; transform: translateX(-102%); transition: transform 0.22s ease; box-shadow: none; }
  .side.open { transform: translateX(0); box-shadow: 0 0 40px rgba(0,0,0,0.35); }
  .topbar { display: flex; }
  .main { width: 100%; }
  .content { padding: 16px; }
}
</style>