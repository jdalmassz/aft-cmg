<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { ok, err } from '../toast'
import { getCatalogo, invalidarCatalogo } from '../catalogo'
import { construirDocumento, imprimirDocumento } from '../imprimir'
import { confirmar } from '../confirm'

const areas = ref([])
// El servidor devuelve el detalle de cada área: no se enseña, sólo sirve para
// contar cuántos responsables y cuántos activos lleva cada área.
const responsables = ref([])
// Los custodios del selector «Responsable del área» (jefe).
const custodios = ref([])
const loading = ref(true)
const error = ref('')

const cajon = ref(null)
const form = ref({ nombre: '', responsable_id: '' })
const guardando = ref(false)
const errForm = ref('')

const grupos = computed(() =>
  areas.value.map((a) => ({ ...a, responsables: responsables.value.filter((u) => u.area_id === a.id) }))
)
const totalActivos = (rs) => rs.reduce((s, r) => s + r.activos, 0)

// El número nunca se escribe: al crear es el siguiente libre y sale en pantalla
// antes de guardar; al editar sólo se enseña.
const siguiente = computed(() => Math.max(0, ...areas.value.map((a) => a.numero)) + 1)

async function cargar() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/api/admin/areas')
    areas.value = r.areas
    responsables.value = r.ubicaciones
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

function abrir(item = null) {
  errForm.value = ''
  form.value = { nombre: item?.nombre || '', responsable_id: item?.responsable_id ?? '' }
  cajon.value = { item }
}

const tituloCajon = computed(() => (cajon.value?.item ? 'Editar área' : 'Nueva área'))

async function guardar() {
  const { item } = cajon.value
  const nombre = String(form.value.nombre || '').trim()
  if (!nombre) { errForm.value = 'Pon el nombre del área'; return }
  const body = { nombre, responsable_id: form.value.responsable_id === '' ? null : Number(form.value.responsable_id) }
  guardando.value = true
  errForm.value = ''
  try {
    if (item) await api.put(`/api/admin/areas/${item.id}`, body)
    else await api.post('/api/admin/areas', body)
    ok('Área guardada')
    cajon.value = null
    invalidarCatalogo()
    cargar()
  } catch (e) { errForm.value = e.message } finally { guardando.value = false }
}

// El Excel de áreas: una fila por área con su jefe.
const exportando = ref(false)

async function exportarExcel() {
  exportando.value = true
  try {
    await api.download('/api/admin/areas/export/xlsx', 'Areas-y-responsables-' + new Date().toISOString().slice(0, 10) + '.xlsx')
    ok('Excel descargado')
  } catch (e) { err(e.message) } finally { exportando.value = false }
}

// La misma hoja, pero para papel: el diálogo del navegador (deja guardar en PDF).
function imprimir() {
  imprimirDocumento(construirDocumento({
    titulo: 'Áreas y Responsables',
    subtitulo: 'Áreas con su responsable principal',
    columnas: [{ t: 'Nº' }, { t: 'Área' }, { t: 'Responsable del área' }],
    filas: areas.value.map((a) => [a.numero, a.etiqueta, a.responsable || ''])
  }))
}

// ── Modo orden: «Renumerar» deja mover las áreas arrastrando ─────────────
// Al entrar sólo se reordena en pantalla; los números se tocan al guardar
// (POST /api/admin/areas/orden), que los recalcula 1…N en ese orden.
const modoOrden = ref(false)
const guardandoOrden = ref(false)
const arrastrando = ref(null) // id de la tarjeta que se arrastra
const sobre = ref(null) // id de la tarjeta que tiene debajo
let ordenOriginal = []

const idxDe = (id) => areas.value.findIndex((a) => a.id === id)

function entrarOrden() {
  ordenOriginal = areas.value.map((a) => a.id)
  modoOrden.value = true
}

function sucio() {
  return JSON.stringify(areas.value.map((a) => a.id)) !== JSON.stringify(ordenOriginal)
}

function salirOrden() {
  modoOrden.value = false
  arrastrando.value = null
  sobre.value = null
  cargar()
}

function cancelarOrden() {
  if (!sucio()) return salirOrden()
  confirmar({
    titulo: 'Cancelar el orden',
    mensaje: 'Se pierde el orden que llevas montado y las áreas vuelven como estaban.'
  }, salirOrden)
}

async function guardarOrden() {
  guardandoOrden.value = true
  try {
    await api.post('/api/admin/areas/orden', { ids: areas.value.map((a) => a.id) })
    ok('Orden guardado: áreas renumeradas 1…N')
    modoOrden.value = false
    invalidarCatalogo()
    await cargar()
  } catch (e) { err(e.message) } finally { guardandoOrden.value = false }
}

// Mover una posición: el respaldo táctil, porque el arrastre de HTML5 no va
// en móvil (y en el ratón también sirve).
function mover(id, dir) {
  const i = idxDe(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= areas.value.length) return
  const arr = [...areas.value]
  const [mov] = arr.splice(i, 1)
  arr.splice(j, 0, mov)
  areas.value = arr
}

// Arrastre con el ratón: al pasar sobre otra tarjeta se coloca antes o
// después según la mitad en la que se entra, y la lista se reordena al vuelo.
function dragStart(a, e) {
  if (!modoOrden.value) return
  arrastrando.value = a.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(a.id)) // Firefox no arranca sin esto
}

function dragOver(a, e) {
  if (!modoOrden.value || !arrastrando.value || arrastrando.value === a.id) return
  e.preventDefault()
  sobre.value = a.id
  const arr = areas.value
  const de = idxDe(arrastrando.value)
  const para = idxDe(a.id)
  if (de < 0 || para < 0) return
  const rect = e.currentTarget.getBoundingClientRect()
  let destino = para + (e.clientX > rect.left + rect.width / 2 ? 1 : 0)
  const copia = [...arr]
  const [mov] = copia.splice(de, 1)
  if (de < destino) destino -= 1
  if (destino === de) return
  copia.splice(destino, 0, mov)
  areas.value = copia
}

function dragEnd() {
  arrastrando.value = null
  sobre.value = null
}

// Cada responsable lleva su número dentro del área y el 1 es el que más activos
// tiene. Los números no se mueven solos: se piden aquí, cuando cambia alguien.
const renumerando = ref(false)

function renumerar() {
  confirmar({
    titulo: 'Renumerar por responsable',
    mensaje: 'Los números vuelven a cuadrarse con sus responsables: el 1 pasa a ser el que más activos tiene y cada activo se queda con su persona. Los cambios quedan en el historial de movimientos. FACTURACION no se toca.'
  }, async () => {
    renumerando.value = true
    try {
      const r = await api.post('/api/admin/ubicaciones/renumerar', {})
      const movidos = r.familias.reduce((s, f) => s + (f.movidos || 0), 0)
      ok(movidos ? `Renumerado: ${movidos} activo(s) movido(s)` : 'Ya estaba cuadrado')
      invalidarCatalogo()
      cargar()
    } catch (e) { err(e.message) } finally { renumerando.value = false }
  })
}

function eliminar() {
  const { item } = cajon.value
  confirmar({
    titulo: 'Eliminar área',
    mensaje: `¿Eliminar "${item.etiqueta}"? Esta acción no se puede deshacer.`,
    peligro: true
  }, async () => {
    try {
      await api.del(`/api/admin/areas/${item.id}`)
      ok('Eliminado')
      cajon.value = null
      invalidarCatalogo()
      cargar()
    } catch (e) { err(e.message) }
  })
}

onMounted(() => {
  cargar()
  // El select del jefe vive del catálogo (la misma caché que el resto de pantallas).
  getCatalogo().then((c) => { custodios.value = c.custodios || [] }).catch(() => {})
})
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h2>Áreas</h2>
        <p v-if="modoOrden" class="muted"><b>Modo orden:</b> arrastra las tarjetas (o usa ↑ ↓) hasta donde quieras. Al guardar, los números salen 1…N en ese orden.</p>
        <p v-else class="muted">{{ areas.length }} área(s) · {{ responsables.length }} responsable(s). Cada área agrupa a sus responsables.</p>
      </div>
      <span class="btns" v-if="modoOrden">
        <button class="btn sec" @click="cancelarOrden">Cancelar</button>
        <button class="btn" :disabled="guardandoOrden" @click="guardarOrden">{{ guardandoOrden ? 'Guardando…' : 'Guardar orden' }}</button>
      </span>
      <span class="btns" v-else>
        <button class="btn sec" title="Hoja de áreas y responsables para papel o PDF" @click="imprimir"><AppIcon name="printer" :size="14" /> Imprimir</button>
        <button class="btn sec" :disabled="exportando" title="Excel con las áreas y sus responsables" @click="exportarExcel"><AppIcon name="file" :size="14" /> {{ exportando ? 'Generando…' : 'Exportar Excel' }}</button>
        <button class="btn sec" :disabled="renumerando" title="El 1 de cada familia pasa a ser el responsable con más activos" @click="renumerar"><AppIcon name="check" :size="14" /> {{ renumerando ? 'Renumerando…' : 'Renumerar ubicaciones' }}</button>
        <button class="btn sec" title="Mover las áreas arrastrando y renumerarlas 1…N" @click="entrarOrden"><AppIcon name="rows" :size="14" /> Renumerar</button>
        <button class="btn" @click="abrir()"><AppIcon name="plus" :size="14" /> Nueva área</button>
      </span>
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error" class="err">{{ error }}</p>

    <div v-else class="grid">
      <div v-for="g in grupos" :key="g.id" class="card area"
           :class="{ modo: modoOrden, arrastrando: arrastrando === g.id, sobre: sobre === g.id && arrastrando !== g.id }"
           :draggable="modoOrden"
           @dragstart="dragStart(g, $event)"
           @dragover="dragOver(g, $event)"
           @drop.prevent
           @dragend="dragEnd">
        <div class="area-head">
          <div>
            <b>{{ g.etiqueta }}</b>
            <span v-if="g.responsable" class="area-jefe"><AppIcon name="user-check" :size="13" /> {{ g.responsable }}</span>
            <span class="muted">{{ g.responsables.length }} responsable(s) · {{ totalActivos(g.responsables) }} activo(s)</span>
          </div>
          <span class="orden-btns" v-if="modoOrden">
            <button class="btn sec sm" title="Subir" :disabled="idxDe(g.id) === 0" @click="mover(g.id, -1)"><AppIcon name="chevron-up" :size="14" /></button>
            <button class="btn sec sm" title="Bajar" :disabled="idxDe(g.id) === areas.length - 1" @click="mover(g.id, 1)"><AppIcon name="chevron-down" :size="14" /></button>
          </span>
          <button v-else class="btn sec sm" title="Editar área" @click="abrir(g)"><AppIcon name="edit" :size="14" /></button>
        </div>
      </div>
    </div>

    <Drawer :open="!!cajon" :titulo="tituloCajon" @close="cajon = null">
      <template v-if="cajon">
        <p v-if="errForm" class="err">{{ errForm }}</p>
        <p class="muted nota">
          <template v-if="cajon.item">Número: <b>{{ cajon.item.numero }}</b> (no se cambia)</template>
          <template v-else>Se creará como <b>Área {{ siguiente }}</b>: el número se asigna solo.</template>
        </p>
        <div class="form-grid una">
          <div class="field">
            <label>Nombre del área *</label>
            <input v-model="form.nombre" class="input" placeholder="Sale como «Área 2 - NOMBRE»" @keyup.enter="guardar" />
          </div>
          <div class="field">
            <label>Responsable del área (jefe)</label>
            <select v-model="form.responsable_id" class="select">
              <option value="">Sin responsable</option>
              <option v-for="c in custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option>
            </select>
            <small class="muted">Quien responde por toda el área; sale en el Excel de áreas.</small>
          </div>
        </div>
        <p v-if="cajon.item" class="muted nota">{{ cajon.item.responsables.length }} responsable(s) en esta área.</p>
      </template>
      <template #pie>
        <button v-if="cajon?.item" class="btn danger" @click="eliminar"><AppIcon name="trash" :size="15" /> Eliminar</button>
        <button class="btn sec" @click="cajon = null">Cancelar</button>
        <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
.head h2 { margin: 0; }
.head .btns { display: flex; gap: 8px; }
.muted { color: var(--muted); margin: 4px 0 0; }
.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }
.nota { font-size: 12px; margin-top: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.area { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.area-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.area-head b { display: block; font-size: 14px; }
.area-head .muted { font-size: 12px; }
.area-jefe { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; margin-top: 3px; }
.orden-btns { display: flex; gap: 4px; }
.area.modo { cursor: grab; user-select: none; }
.area.modo:active { cursor: grabbing; }
.area.arrastrando { opacity: 0.35; }
.area.sobre { outline: 2px dashed var(--primary); outline-offset: 2px; }
</style>
