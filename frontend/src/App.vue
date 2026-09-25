<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getUser, clearSession, logout as doLogout } from './api'
import AppIcon from './components/AppIcon.vue'
import Toasts from './components/Toasts.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()

const user = computed(() => getUser())
const isAuthPage = computed(() => route.path === '/login')
const menuOpen = ref(false)
const colapsado = ref(localStorage.getItem('aft_sidebar') === '1')

// Pie del lateral: avatar con las iniciales, el nombre y el rol como píldora.
const quienEs = computed(() => user.value?.nombre || user.value?.username || '')
const iniciales = computed(() => {
  const partes = quienEs.value.trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '·'
  return partes.slice(0, 2).map((p) => p[0]).join('').toUpperCase()
})
const rolEtiqueta = computed(() => {
  const r = user.value?.rol_accesos
  if (r) return r.toLowerCase().replace(/\b[a-záéíóúñ]/g, (c) => c.toUpperCase())
  return user.value?.rol === 'admin' ? 'Administrador' : 'Usuario'
})

const pageTitle = computed(() => {
  const t = { '/inicio': 'Dashboard', '/activos': 'Inventario', '/utiles': 'Útiles y herramientas', '/responsables': 'Responsables', '/areas': 'Áreas' }
  return t[route.path] || 'AFT Camagüey'
})

function toggleColapsado() {
  colapsado.value = !colapsado.value
  localStorage.setItem('aft_sidebar', colapsado.value ? '1' : '0')
}

async function logout() {
  // La cookie httpOnly la borra el servidor (el frontend no puede tocarla);
  // la sesión local también se limpia aquí por si el token ya había expirado.
  try { await doLogout() } catch { clearSession() }
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
          <div class="brand-txt">
            <div class="brand-name">AFT Camagüey</div>
            <div class="brand-sub">Logística de Activos</div>
          </div>
          <button class="side-toggle" :title="colapsado ? 'Expandir menú' : 'Contraer menú'" @click="toggleColapsado"><AppIcon name="menu" :size="16" /></button>
        </div>
        <nav>
          <router-link to="/inicio" class="nav-link" active-class="act" title="Dashboard"><AppIcon name="chart" :size="17" /> <span class="nl-txt">Dashboard</span></router-link>
          <router-link to="/activos" class="nav-link" active-class="act" title="Inventario"><AppIcon name="box" :size="17" /> <span class="nl-txt">Inventario</span></router-link>
          <router-link to="/utiles" class="nav-link" active-class="act" title="Útiles y herramientas"><AppIcon name="panel" :size="17" /> <span class="nl-txt">Útiles</span></router-link>
          <router-link v-if="user?.rol === 'admin'" to="/responsables" class="nav-link" active-class="act" title="Responsables"><AppIcon name="user-check" :size="17" /> <span class="nl-txt">Responsables</span></router-link>
          <router-link v-if="user?.rol === 'admin'" to="/areas" class="nav-link" active-class="act" title="Áreas y ubicaciones"><AppIcon name="map-pin" :size="17" /> <span class="nl-txt">Áreas</span></router-link>
        </nav>
        <div class="side-foot">
          <div class="who-row">
            <div class="avatar">{{ iniciales }}</div>
            <div class="who-txt">
              <div class="who">{{ quienEs }}</div>
              <div class="role">{{ rolEtiqueta }}</div>
            </div>
            <button class="salir" title="Salir" aria-label="Salir" @click="logout"><AppIcon name="log-out" :size="16" /></button>
          </div>
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
.brand { display: flex; align-items: center; gap: 10px; padding: 6px 4px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 16px; position: relative; }
.logo { color: #60a5fa; display: flex; }
.brand-txt { min-width: 0; overflow: hidden; white-space: nowrap; }
.brand-name { font-weight: 800; font-size: 15px; }
.brand-sub { font-size: 11px; color: #94a3b8; }
.side-toggle {
  margin-left: auto; background: none; border: none; cursor: pointer;
  color: #94a3b8; padding: 6px; border-radius: 6px; display: flex;
}
.side-toggle:hover { color: #fff; background: rgba(255,255,255,0.08); }
.side-toggle:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.nav-link { color: #cbd5e1; padding: 9px 12px; border-radius: 8px; font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 9px; overflow: hidden; white-space: nowrap; }
.nav-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
.nav-link.act { background: var(--primary); color: #fff; }
.side-foot { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; }
.who-row { display: flex; align-items: center; gap: 10px; }
.avatar {
  flex: none; width: 34px; height: 34px; border-radius: 50%;
  background: var(--primary); color: #fff; font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
}
.who-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.who { font-weight: 700; font-size: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.role {
  align-self: flex-start; max-width: 100%; font-size: 10px; font-weight: 700;
  color: #bfdbfe; background: rgba(96,165,250,0.18); border-radius: 999px;
  padding: 1px 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.salir {
  flex: none; background: none; border: 0; cursor: pointer; color: #94a3b8;
  padding: 7px; border-radius: 8px; display: flex;
}
.salir:hover { color: #fff; background: rgba(255,255,255,0.08); }
.salir:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  display: none; align-items: center; gap: 12px; padding: 12px 16px;
  background: #0f172a; color: #fff; position: sticky; top: 0; z-index: 600;
}
.tb-title { font-weight: 800; font-size: 15px; }
.backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 650; }
.content { flex: 1; padding: 24px 28px; overflow-x: hidden; }

@media (min-width: 821px) {
  .side.collapsed { width: 66px; padding: 18px 10px; }
  .side.collapsed .brand { justify-content: center; padding-bottom: 14px; }
  .side.collapsed .brand-txt { display: none; }
  .side.collapsed .side-toggle { margin-left: 0; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
  .side.collapsed .logo { visibility: hidden; }
  .side.collapsed .nav-link { justify-content: center; padding: 11px 0; }
  .side.collapsed .nl-txt { display: none; }
  .side.collapsed .who-txt, .side.collapsed .salir { display: none; }
  .side.collapsed .who-row { justify-content: center; }
}

@media (max-width: 820px) {
  .side { position: fixed; left: 0; top: 0; transform: translateX(-102%); transition: transform 0.22s ease; box-shadow: none; }
  .side.open { transform: translateX(0); box-shadow: 0 0 40px rgba(0,0,0,0.35); }
  .topbar { display: flex; }
  .main { width: 100%; }
  .content { padding: 16px; }
}
</style>