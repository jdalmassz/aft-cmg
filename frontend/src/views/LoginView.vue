<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login, setSession, fetchMe, getUser } from '../api'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// Accesos (SSO): el token viaja en cookie httpOnly, que el navegador envía
// automáticamente. Tras el callback, /api/me ya llega autenticado; aquí solo
// redirigimos a donde la persona quería ir.
async function finishLogin() {
  try {
    await fetchMe()
    router.push(route.query.redirect || '/inicio')
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  const sso = route.query.sso
  if (sso === 'nodisponible') {
    error.value = 'Accesos no está disponible; usa el usuario y la contraseña de abajo.'
  } else if (sso === 'error') {
    error.value = 'No se pudo entrar por Accesos. Revisa el registro del servidor.'
  } else if (sso === 'sincodigo') {
    error.value = 'Falta el código de Accesos; vuelve a intentarlo.'
  } else if (sso === 'ok') {
    finishLogin()
  }
})

async function submit(e) {
  e.preventDefault()
  error.value = ''
  loading.value = true
  try {
    const res = await login(username.value, password.value)
    setSession(res.token, res.user)
    router.push(route.query.redirect || '/inicio')
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login card" @submit="submit">
      <div class="logo"><AppIcon name="box" :size="60" /></div>
      <h1>AFT Camagüey</h1>
      <p class="sub">Sistema de logística de activos fijos tangibles</p>
      <a class="btn btn-sso" :href="route.query.redirect ? `/api/auth/entrar?returnTo=${encodeURIComponent(route.query.redirect)}` : '/api/auth/entrar'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
        Entrar por Accesos
      </a>
      <div class="divider"><span>o con usuario local</span></div>
      <input v-model.trim="username" class="input" placeholder="Usuario" autocomplete="username" />
      <input v-model="password" type="password" class="input" placeholder="Contraseña" autocomplete="current-password" />
      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn" type="submit" :disabled="loading">
        <span v-if="loading" class="spinner" style="width:14px;height:14px;border-color:#fff;border-top-color:transparent"></span>
        {{ loading ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.sso-link { text-decoration: none; color: inherit; }
.btn-sso {
  background: transparent;
  color: var(--primary, #3b82f6);
  border: 1px solid var(--primary, #3b82f6);
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  margin-bottom: 8px;
}
.btn-sso:hover { background: rgba(59, 130, 246, 0.12); }
.divider { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; margin: 4px 0 12px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border, #e2e8f0); }
</style>

<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a, #1e3a8a); }
.login { width: 100%; max-width: 360px; padding: 34px 30px; display: flex; flex-direction: column; gap: 14px; }
.logo { text-align: center; color: var(--primary); display: flex; justify-content: center; }
h1 { margin: 0; font-size: 22px; text-align: center; }
.sub { margin: -8px 0 4px; text-align: center; color: var(--muted); font-size: 13px; }
.err { color: var(--danger); font-weight: 600; font-size: 13px; margin: 0; }
button.btn { justify-content: center; padding: 11px; font-size: 14px; }
</style>