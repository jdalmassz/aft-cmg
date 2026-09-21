<script setup>
import { ref, onMounted } from 'vue'
import { api, getUser } from '../api'

const usuarios = ref([])
const loading = ref(true)
const error = ref('')
const mostrar = ref(false)
const formulario = ref({ username: '', password: '', nombre: '', rol: 'usuario' })
const guardando = ref(false)

async function cargar() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/api/admin/users')
    usuarios.value = r.filter((u) => u.id !== getUser()?.id)
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

function abrir() {
  formulario.value = { username: '', password: '', nombre: '', rol: 'usuario' }
  mostrar.value = true
}

async function guardar() {
  guardando.value = true
  error.value = ''
  try {
    await api.post('/api/admin/users', formulario.value)
    mostrar.value = false
    cargar()
  } catch (e) { error.value = e.message } finally { guardando.value = false }
}

async function toggleActivo(u) {
  await api.put(`/api/admin/users/${u.id}`, { activo: !u.activo })
  cargar()
}

async function resetPass(u) {
  const pass = prompt(`Nueva contraseña para "${u.username}":`)
  if (!pass) return
  await api.put(`/api/admin/users/${u.id}`, { password: pass })
  cargar()
}

onMounted(cargar)
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h2>Usuarios</h2>
        <p class="muted">{{ usuarios.length + 1 }} usuario(s) registrados</p>
      </div>
      <button class="btn" @click="abrir">+ Nuevo usuario</button>
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error" class="err">{{ error }}</p>

    <div v-else class="card table-wrap">
      <table class="tbl">
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Creado</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          <tr v-for="u in usuarios" :key="u.id">
            <td><b>{{ u.username }}</b></td>
            <td>{{ u.nombre || '—' }}</td>
            <td>{{ u.rol === 'admin' ? 'Administrador' : 'Usuario' }}</td>
            <td>{{ new Date(u.created_at).toLocaleDateString('es-CU') }}</td>
            <td><span class="badge" :class="u.activo ? 'ok' : 'warn'">{{ u.activo ? 'Activo' : 'Inactivo' }}</span></td>
            <td>
              <button class="btn sec sm" @click="resetPass(u)">🔑 Contraseña</button>
              <button class="btn sec sm" @click="toggleActivo(u)">{{ u.activo ? 'Desactivar' : 'Activar' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="mostrar" class="modal-overlay" @click.self="mostrar = false">
      <div class="modal">
        <div class="modal-head">Nuevo usuario <button class="close" @click="mostrar = false">×</button></div>
        <div class="modal-body">
          <p v-if="error" class="err">{{ error }}</p>
          <div class="form-grid">
            <div class="field"><label>Usuario *</label><input v-model="formulario.username" class="input" required /></div>
            <div class="field"><label>Contraseña *</label><input v-model="formulario.password" type="password" class="input" required /></div>
            <div class="field"><label>Nombre</label><input v-model="formulario.nombre" class="input" /></div>
            <div class="field"><label>Rol</label>
              <select v-model="formulario.rol" class="select"><option value="usuario">Usuario</option><option value="admin">Administrador</option></select>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn sec" @click="mostrar = false">Cancelar</button>
          <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.head h2 { margin: 0; } .muted { color: var(--muted); margin: 4px 0 0; }
.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }
</style>