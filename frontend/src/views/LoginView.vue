<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const error = ref('')

// Accesos es la ÚNICA puerta: la pantalla de login vive en
// auth.procovar.cloud y aquí sólo se redirige hacia ella. Al volver, el
// backend canjea el código y escribe la cookie httpOnly, así que después de
// vuelta no hay nada más que hacer en esta pantalla.
onMounted(() => {
  const sso = route.query.sso
  if (sso === 'nodisponible') {
    error.value = 'Accesos no está disponible; inténtalo más tarde.'
  } else if (sso === 'error') {
    error.value = 'No se pudo entrar por Accesos. Revisa el registro del servidor.'
  } else if (sso === 'sincodigo') {
    error.value = 'Falta el código de Accesos; vuelve a intentarlo.'
  }
})
</script>

<template>
  <div class="login-wrap">
    <div class="login card">
      <div class="logo"><AppIcon name="box" :size="60" /></div>
      <h1>AFT Camagüey</h1>
      <p class="sub">Sistema de logística de activos fijos tangibles</p>
      <a class="btn btn-sso" :href="route.query.redirect ? `/api/auth/entrar?returnTo=${encodeURIComponent(route.query.redirect)}` : '/api/auth/entrar'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
        Entrar por Accesos
      </a>
      <p v-if="error" class="err">{{ error }}</p>
      <p class="nota">Se entra con tu usuario y contraseña de Procovar, en
        <a href="https://auth.procovar.cloud" target="_blank" rel="noopener">auth.procovar.cloud</a>.</p>
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
.nota a { color: var(--primary, #3b82f6); }
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
