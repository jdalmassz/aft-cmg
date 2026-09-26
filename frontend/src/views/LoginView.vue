<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getUser } from '../api'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const route = useRoute()
const error = ref('')

// Accesos es la ÚNICA puerta y esta pantalla no es un login: no enseña usuario
// ni contraseña, sólo manda para allá. El salto se lanza AQUÍ, en el setup, que
// es antes del primer render: así no da tiempo a pintar nada que parezca el
// login viejo mientras el navegador cambia de sitio.
//
// Ojo con el bucle: si la ida falla, /api/auth/entrar devuelve /?sso=… y esa
// vuelta SÍ se queda en esta pantalla para enseñar el motivo. Mientras haya un
// ?sso= en la URL no se vuelve a saltar.
const entrarUrl = computed(() =>
  route.query.redirect
    ? `/api/auth/entrar?returnTo=${encodeURIComponent(route.query.redirect)}`
    : '/api/auth/entrar'
)

const sso = route.query.sso
if (sso === 'nodisponible') {
  error.value = 'Accesos no está disponible; inténtalo más tarde.'
} else if (sso === 'error') {
  error.value = 'No se pudo entrar por Accesos. Revisa el registro del servidor.'
} else if (sso === 'sincodigo') {
  error.value = 'Falta el código de Accesos; vuelve a intentarlo.'
} else if (getUser()) {
  // Quien ya tiene la cookie viva no tiene por qué pasar por Accesos otra vez.
  router.replace(route.query.redirect || '/inicio')
} else {
  window.location.replace(entrarUrl.value)
}
</script>

<template>
  <div class="login-wrap">
    <div v-if="!error" class="carga">
      <div class="logo"><AppIcon name="box" :size="54" /></div>
      <h1>AFT Camagüey</h1>
      <div class="spin" aria-hidden="true"></div>
      <p class="nota">
        Abriendo <b>Accesos</b>…<br />
        <a :href="entrarUrl">si no se abre solo, haz clic aquí</a>
      </p>
    </div>

    <div v-else class="carga">
      <div class="logo fallo"><AppIcon name="alert-triangle" :size="54" /></div>
      <h1>No se pudo entrar</h1>
      <p class="nota">{{ error }}</p>
      <a class="btn btn-sso" :href="entrarUrl">Volver a intentar con Accesos</a>
      <p class="nota">Se entra con tu usuario y contraseña de Procovar.</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f172a, #1e3a8a);
}
.carga {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  padding: 34px 30px;
  color: #e5e7eb;
}
.logo { color: #60a5fa; }
.logo.fallo { color: #fca5a5; }
h1 { margin: 0; font-size: 22px; color: #fff; }
.nota { margin: 0; font-size: 13px; line-height: 1.6; color: #cbd5e1; }
.nota a { color: #93c5fd; text-decoration: underline; }
.nota b { color: #fff; }
/* Spinner sencillo: la única pista de que hay un salto en marcha. */
.spin {
  width: 26px;
  height: 26px;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: #93c5fd;
  border-radius: 50%;
  animation: girar 0.8s linear infinite;
}
@keyframes girar { to { transform: rotate(360deg); } }
.btn-sso {
  background: transparent;
  color: #93c5fd;
  border: 1px solid #93c5fd;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.btn-sso:hover { background: rgba(147, 197, 253, 0.14); }
</style>
