<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login, setSession } from '../api'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

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
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a, #1e3a8a); }
.login { width: 100%; max-width: 360px; padding: 34px 30px; display: flex; flex-direction: column; gap: 14px; }
.logo { text-align: center; color: var(--primary); display: flex; justify-content: center; }
h1 { margin: 0; font-size: 22px; text-align: center; }
.sub { margin: -8px 0 4px; text-align: center; color: var(--muted); font-size: 13px; }
.err { color: var(--danger); font-weight: 600; font-size: 13px; margin: 0; }
button.btn { justify-content: center; padding: 11px; font-size: 14px; }
</style>