<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getUser } from '../api'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const route = useRoute()
const error = ref('')
const yendo = ref(false)

// Accesos es la ÚNICA puerta y la pantalla de login no espera aquí: en cuanto
// se abre /login se manda a auth.procovar.cloud, que es donde la gente se
// identifica, y de allí vuelve al backend con el código.
//
// Ojo con el bucle: si la ida falla, /api/auth/entrar devuelve /?sso=… y esa
// vuelta SÍ se queda en esta pantalla. Mientras haya un ?sso= en la URL no se
// vuelve a saltar: se enseña el motivo y se deja repetir a mano.
const entrarUrl = computed(() =>
  route.query.redirect
    ? `/api/auth/entrar?returnTo=${encodeURIComponent(route.query.redirect)}`
    : '/api/auth/entrar'
)

onMounted(() => {
  const sso = route.query.sso
  if (sso === 'nodisponible') {
    error.value = 'Accesos no está disponible; inténtalo más tarde.'
    return
  }
  if (sso === 'error') {
    error.value = 'No se pudo entrar por Accesos. Revisa el registro del servidor.'
    return
  }
  if (sso === 'sincodigo') {
    error.value = 'Falta el código de Accesos; vuelve a intentarlo.'
    return
  }
  // Quien ya tiene sesión (la cookie sigue viva) no tiene por qué pasar por
  // Accesos otra vez: se le sigue a donde iba.
  if (getUser()) {
    router.push(route.query.redirect || '/inicio')
    return
  }
  yendo.value = true
  window.location.href = entrarUrl.value
})
</script>

<template>
  <div class="login-wrap">
    <div class="login card">
      <div class="logo"><AppIcon name="box" :size="60" /></div>
      <h1>AFT Camagüey</h1>
      <p class="sub">Sistema de logística de activos fijos tangibles</p>
      <a class="btn btn-sso" :href="entrarUrl">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
        Entrar por Accesos
      </a>
      <p v-if="yendo && !error" class="nota">Te llevamos a <b>auth.procovar.cloud</b>…</p>
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="error" class="nota">Se entra con tu usuario y contraseña de Procovar.</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a, #1e3a8a); }
.login { width: 100%; max-width: 360px; padding: 34px 30px; display: flex; flex-direction: column; gap: 14px; }
.logo { text-align: center; color: var(--primary); display: flex; justify-content: center; }
h1 { margin: 0; font-size: 22px; text-align: center; }
.sub { margin: -8px 0 4px; text-align: center; color: var(--muted); font-size: 13px; }
.err { color: var(--danger); font-weight: 600; font-size: 13px; margin: 0; }
.nota { margin: 0; text-align: center; color: var(--muted); font-size: 12px; line-height: 1.5; }
.btn-sso {
  background: transparent;
  color: var(--primary, #3b82f6);
  border: 1px solid var(--primary, #3b82f6);
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.btn-sso:hover { background: rgba(59, 130, 246, 0.12); }
</style>
