<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'

const lista = ref([])
const loading = ref(true)
const error = ref('')
const q = ref('')

const mostrar = ref(false)
const editando = ref(null)
const nombre = ref('')
const userId = ref('')
const usuarios = ref([])
const guardando = ref(false)

const filtrados = computed(() => {
  const t = q.value.trim().toLowerCase()
  if (!t) return lista.value
  return lista.value.filter((c) => c.nombre.toLowerCase().includes(t))
})

const totalActivos = computed(() => lista.value.reduce((s, c) => s + c.activos, 0))

async function cargar() {
  loading.value = true
  error.value = ''
  try {
    ;[lista.value, usuarios.value] = await Promise.all([api.get('/api/admin/custodios'), api.get('/api/admin/users')])
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

function abrirNuevo() {
  editando.value = null
  nombre.value = ''
  userId.value = ''
  mostrar.value = true
}

function abrirEditar(c) {
  editando.value = c
  nombre.value = c.nombre
  userId.value = c.user_id || ''
  mostrar.value = true
}

async function guardar() {
  const n = nombre.value.trim()
  if (!n) { error.value = 'Escribe el nombre del responsable'; return }
  guardando.value = true
  error.value = ''
  try {
    if (editando.value) {
      await api.put(`/api/admin/custodios/${editando.value.id}`, { nombre: n, user_id: userId.value || null })
      ok('Responsable actualizado')
    } else {
      await api.post('/api/admin/custodios', { nombre: n, user_id: userId.value || null })
      ok('Responsable creado')
    }
    mostrar.value = false
    cargar()
  } catch (e) { error.value = e.message } finally { guardando.value = false }
}

function eliminar(c) {
  if (c.activos > 0) {
    err(`No se puede eliminar: ${c.nombre} tiene ${c.activos} activo(s) asignados`)
    return
  }
  confirmar({
    titulo: 'Eliminar responsable',
    mensaje: `¿Eliminar el responsable "${c.nombre}"? Esta acción no se puede deshacer.`,
    peligro: true
  }, async () => {
    try {
      await api.del(`/api/admin/custodios/${c.id}`)
      ok('Responsable eliminado')
      cargar()
    } catch (e) { err(e.message) }
  })
}

onMounted(cargar)
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h2>Responsables</h2>
        <p class="muted">{{ lista.length }} responsable(s) · {{ totalActivos }} activo(s) asignado(s)</p>
      </div>
      <button class="btn" @click="abrirNuevo"><AppIcon name="plus" :size="14" /> Nuevo responsable</button>
    </div>

    <div class="toolbar">
      <input v-model="q" class="input search" placeholder="Buscar responsable…" />
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error && !mostrar" class="err">{{ error }}</p>

    <div v-else class="card table-wrap">
      <table class="tbl">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Activos</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in filtrados" :key="c.id">
            <td><b>{{ c.nombre }}</b></td>
            <td><span v-if="c.username" class="usr"><AppIcon name="user-check" :size="13" /> {{ c.username }}</span><span v-else class="muted">—</span></td>
            <td><span class="badge" :class="c.activos ? 'ok' : 'warn'">{{ c.activos }}</span></td>
            <td class="acciones">
              <button class="btn sec sm" @click="abrirEditar(c)"><AppIcon name="edit" :size="14" /> Editar</button>
              <button class="btn sec sm" :disabled="c.activos > 0" :title="c.activos > 0 ? 'Tiene activos asignados' : ''" @click="eliminar(c)"><AppIcon name="trash" :size="14" /> Eliminar</button>
            </td>
          </tr>
          <tr v-if="!filtrados.length">
            <td colspan="4" class="vacio">No hay responsables{{ q ? ' que coincidan con la búsqueda' : '' }}.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Drawer :open="mostrar" :titulo="editando ? 'Editar responsable' : 'Nuevo responsable'" @close="mostrar = false">
      <p v-if="error" class="err">{{ error }}</p>
      <div class="field">
        <label>Nombre *</label>
        <input v-model="nombre" class="input" placeholder="Nombre completo del responsable" @keyup.enter="guardar" />
      </div>
      <div class="field vinculo">
        <label>Usuario del sistema</label>
        <select v-model="userId" class="select">
          <option value="">Sin vincular</option>
          <option v-for="u in usuarios" :key="u.id" :value="u.id" :disabled="lista.some((c) => c.user_id === u.id && c.id !== editando?.id)">{{ u.username }}{{ u.nombre ? ' — ' + u.nombre : '' }}</option>
        </select>
      </div>
      <template #pie>
        <button class="btn sec" @click="mostrar = false">Cancelar</button>
        <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.head h2 { margin: 0; }
.muted { color: var(--muted); margin: 4px 0 0; }
.toolbar { margin-bottom: 14px; }
.search { max-width: 320px; }
.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }
.acciones { text-align: right; white-space: nowrap; }
.acciones .btn { margin-left: 6px; }
.vacio { text-align: center; color: var(--muted); padding: 28px 12px; }
.vinculo { margin-top: 12px; }
.usr { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--primary-dark); }
</style>
