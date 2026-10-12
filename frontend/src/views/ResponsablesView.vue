<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'
import { invalidarCatalogo } from '../catalogo'
import { construirDocumento } from '../imprimir'

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

/*
 * Hoja de responsables y sus áreas: la MISMA que se imprime y la que sale en el
 * Excel. Se enseña en un cajón con la hoja dentro (un iframe con el documento),
 * y desde ahí se puede imprimir (papel o PDF del navegador) o bajar el .xlsx.
 */
const hojaAbierta = ref(false)
const visorHtml = ref(null)
const exportando = ref(false)

const filasHoja = computed(() =>
  filtrados.value.map((c) => [c.nombre, (c.areas || []).join(', '), String(c.activos)])
)

const htmlHoja = computed(() => construirDocumento({
  titulo: 'Responsables y Áreas',
  subtitulo: `${filtrados.value.length} responsable(s)`,
  columnas: [{ t: 'Responsable' }, { t: 'Áreas' }, { t: 'Activos', clase: 'num' }],
  filas: filasHoja.value
}))

function imprimirHoja() {
  const w = visorHtml.value?.contentWindow
  if (w) {
    try { w.focus(); w.print(); return } catch (_) { /* respaldo abajo */ }
  }
  // Sin visor (raro): se imprime el mismo documento en un marco aparte.
  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
  marco.addEventListener('load', () => {
    try { marco.contentWindow.focus(); marco.contentWindow.print() } catch (_) { /* nada */ }
    setTimeout(() => marco.remove(), 120000)
  })
  document.body.appendChild(marco)
  marco.srcdoc = htmlHoja.value
}

async function exportarExcel() {
  exportando.value = true
  try {
    await api.download('/api/admin/custodios/export/xlsx', 'Responsables-y-areas-' + new Date().toISOString().slice(0, 10) + '.xlsx')
    ok('Excel descargado')
  } catch (e) { err(e.message) } finally { exportando.value = false }
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
    invalidarCatalogo()
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
      invalidarCatalogo()
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
      <span class="btns">
        <button class="btn sec" title="Hoja de responsables y sus áreas: vista previa, imprimirla o bajarla en Excel" @click="hojaAbierta = true">
          <AppIcon name="printer" :size="14" /> Hoja responsables
        </button>
        <button class="btn" @click="abrirNuevo"><AppIcon name="plus" :size="14" /> Nuevo responsable</button>
      </span>
    </div>

    <div class="toolbar">
      <input v-model="q" class="input search" placeholder="Buscar responsable…" />
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error && !mostrar" class="err">{{ error }}</p>

    <div v-else class="card table-wrap">
      <table class="tbl">
        <thead><tr><th>Nombre</th><th>Áreas</th><th>Usuario</th><th>Activos</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in filtrados" :key="c.id">
            <td><b>{{ c.nombre }}</b></td>
            <td class="muted">{{ (c.areas || []).join(', ') || '—' }}</td>
            <td><span v-if="c.username" class="usr"><AppIcon name="user-check" :size="13" /> {{ c.username }}</span><span v-else class="muted">—</span></td>
            <td><span class="badge" :class="c.activos ? 'ok' : 'warn'">{{ c.activos }}</span></td>
            <td class="acciones">
              <button class="btn sec sm" @click="abrirEditar(c)"><AppIcon name="edit" :size="14" /> Editar</button>
              <button class="btn sec sm" :disabled="c.activos > 0" :title="c.activos > 0 ? 'Tiene activos asignados' : ''" @click="eliminar(c)"><AppIcon name="trash" :size="14" /> Eliminar</button>
            </td>
          </tr>
          <tr v-if="!filtrados.length">
            <td colspan="5" class="vacio">No hay responsables{{ q ? ' que coincidan con la búsqueda' : '' }}.</td>
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

    <!-- Hoja de responsables: vista previa del mismo documento que se imprime. -->
    <Drawer :open="hojaAbierta" titulo="Responsables y Áreas" :subtitulo="`${filtrados.length} responsable(s)`" :ancho="720" @close="hojaAbierta = false">
      <div class="preview-caja">
        <iframe ref="visorHtml" class="preview-iframe" :srcdoc="htmlHoja" title="Vista previa de la hoja"></iframe>
      </div>
      <template #pie>
        <button class="btn sec" @click="hojaAbierta = false">Cerrar</button>
        <button class="btn sec" :disabled="exportando" @click="exportarExcel"><AppIcon name="file" :size="15" /> {{ exportando ? 'Generando…' : 'Exportar Excel' }}</button>
        <button class="btn" @click="imprimirHoja"><AppIcon name="printer" :size="15" /> Imprimir</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
.head h2 { margin: 0; }
.head .btns { display: flex; gap: 8px; }
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

/* Vista previa de la hoja: el documento dentro del cajón, con su papel gris. */
.preview-caja {
  height: min(70vh, 640px);
  background: #e2e8f0; border: 1px solid var(--border); border-radius: 10px;
  overflow: hidden; display: grid; place-items: center;
}
.preview-iframe { width: 100%; height: 100%; border: 0; background: #fff; }
</style>
