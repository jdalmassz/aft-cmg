<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { api } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'
import { invalidarCatalogo } from '../catalogo'
import { usePreviewPdf } from '../previewPdf'

const lista = ref([])
const loading = ref(true)
const error = ref('')
const q = ref('')

const mostrar = ref(false)
const editando = ref(null)
const nombre = ref('')
const carnet = ref('')
const cargo = ref('')
const userId = ref('')
const usuarios = ref([])
const guardando = ref(false)

const filtrados = computed(() => {
  const t = q.value.trim().toLowerCase()
  if (!t) return lista.value
  return lista.value.filter((c) => c.nombre.toLowerCase().includes(t))
})

const totalActivos = computed(() => lista.value.reduce((s, c) => s + c.activos, 0))
const totalUtiles = computed(() => lista.value.reduce((s, c) => s + c.utiles, 0))
// Para borrar hace falta no tener NI activos NI útiles (el servidor cuenta los dos).
const conAsignacion = (c) => (c.activos || 0) + (c.utiles || 0) > 0

async function cargar() {
  loading.value = true
  error.value = ''
  try {
    ;[lista.value, usuarios.value] = await Promise.all([api.get('/api/admin/custodios'), api.get('/api/admin/users')])
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

/*
 * Hoja de responsables y sus áreas, y el acta de responsabilidad material de
 * cada uno: los DOS documentos los genera el servidor en PDF (mismo papel que
 * sale por la impresora) y aquí sólo se enseñan en el cajón, con sus botones
 * de bajar e imprimir. El filtro de la pantalla entra en la hoja por query.
 */
const preview = usePreviewPdf()
const visorPdf = ref(null)
// Qué PDF está dentro del cajón: manda el nombre al bajarlo.
const tipoPreview = ref('hoja')
const actaNombre = ref('')
const exportandoXls = ref(false)

function filtrosHoja() {
  const f = new URLSearchParams()
  const t = q.value.trim()
  if (t) f.set('q', t)
  return f.toString()
}

async function verHoja() {
  tipoPreview.value = 'hoja'
  await preview.abrir('/api/admin/custodios/export/pdf' + (filtrosHoja() ? '?' + filtrosHoja() : ''))
}

/*
 * El acta de ARRIBA, montada como la hoja de conteo de inventario: un cajón de
 * OPCIONES con el desplegable de la persona y, PEGADO a su izquierda, la vista
 * previa de SU acta. Se pide al abrir el cajón, se vuelve a pedir sola al
 * cambiar de persona (350 ms, sólo si cambió) y cerrar las opciones se lleva
 * la hoja consigo. En móvil no cabe al lado: allí manda el botón «Vista previa».
 */
const actaAbierto = ref(false)
const actaSel = ref('')

const mqMovil = window.matchMedia('(max-width: 640px)')
const enMovil = ref(mqMovil.matches)
const onMovil = (e) => { enMovil.value = e.matches }
mqMovil.addEventListener('change', onMovil)

let tActa = null
let idActa = ''

async function pedirActa() {
  const c = lista.value.find((x) => x.id === actaSel.value)
  if (!c) return
  tipoPreview.value = 'acta-sel'
  actaNombre.value = c.nombre
  idActa = String(actaSel.value)
  await preview.abrir(`/api/admin/custodios/${c.id}/acta/pdf`)
}

// `forzar` = pedirla siempre (con el botón «Vista previa»). Elegir persona la
// pide SOLA, sin esperar a nada: la primera, en cuanto se elige; al cambiar,
// a los 350 ms (como en el resto de vistas previas). El botón se queda para
// volver a verla si la persona la cerró sin cambiarse de nombre.
function refrescarActa(forzar) {
  if (!actaSel.value) { idActa = ''; preview.cerrar(); return }
  if (!actaAbierto.value) return
  if (!forzar && String(actaSel.value) === idActa) return
  clearTimeout(tActa)
  if (forzar || !idActa) pedirActa()
  else tActa = setTimeout(pedirActa, 350)
}

function abrirActa() {
  // Sin persona preseleccionada: el cajón se abre vacío y quien lo usa elige
  // la suya (así no se lleva el acta del primero por accidente).
  actaSel.value = ''
  actaAbierto.value = true
}

// Cerrar el cajón de opciones se lleva el acta con él (son la misma cosa). El
// Escape cierra LOS DOS a la vez: cada cajón escucha por su cuenta.
function cerrarActa() {
  actaAbierto.value = false
  preview.cerrar()
}

// Botón «Vista previa»: se habilita en cuanto hay persona elegida. En móvil las
// dos no caben apiladas, al abrir la hoja se van las opciones.
async function verActaPreview() {
  if (!actaSel.value) return
  await pedirActa()
  if (enMovil.value && preview.abierta) actaAbierto.value = false
}

watch(actaSel, () => refrescarActa(false))
onBeforeUnmount(() => { clearTimeout(tActa); mqMovil.removeEventListener('change', onMovil) })

const tituloPreview = computed(() =>
  tipoPreview.value === 'hoja' ? 'Responsables y Áreas' : 'Acta de responsabilidad material'
)
// El acta va pegado a su cajón de opciones (440 = su ancho); la hoja de
// responsables, que se abre sola, sigue como estaba.
const extraPreview = computed(() => ({ '--dw-pegado': tipoPreview.value === 'hoja' ? '380px' : '440px' }))

const nombreDescarga = computed(() => {
  const fecha = new Date().toISOString().slice(0, 10)
  return tipoPreview.value === 'hoja'
    ? `Responsables-y-areas-${fecha}.pdf`
    : `Acta-responsabilidad-${actaNombre.value.replace(/\s+/g, '_')}-${fecha}.pdf`
})

function descargarPdf() {
  preview.descargar(nombreDescarga.value)
}

async function exportarExcel() {
  exportandoXls.value = true
  try {
    const qs = filtrosHoja()
    await api.download('/api/admin/custodios/export/xlsx' + (qs ? '?' + qs : ''), 'Responsables-y-areas-' + new Date().toISOString().slice(0, 10) + '.xlsx')
    ok('Excel descargado')
  } catch (e) { err(e.message) } finally { exportandoXls.value = false }
}

function abrirNuevo() {
  editando.value = null
  nombre.value = ''
  carnet.value = ''
  cargo.value = ''
  userId.value = ''
  mostrar.value = true
}

// Editar se abre con un CLIC en la fila: la tabla no lleva botones sueltos.
function abrirEditar(c) {
  editando.value = c
  nombre.value = c.nombre
  carnet.value = c.carnet || ''
  cargo.value = c.cargo || ''
  userId.value = c.user_id || ''
  mostrar.value = true
}

async function guardar() {
  const n = nombre.value.trim()
  if (!n) { error.value = 'Escribe el nombre del responsable'; return }
  guardando.value = true
  error.value = ''
  try {
    const datos = { nombre: n, carnet: carnet.value.trim(), cargo: cargo.value.trim(), user_id: userId.value || null }
    if (editando.value) {
      await api.put(`/api/admin/custodios/${editando.value.id}`, datos)
      ok('Responsable actualizado')
    } else {
      await api.post('/api/admin/custodios', datos)
      ok('Responsable creado')
    }
    mostrar.value = false
    invalidarCatalogo()
    cargar()
  } catch (e) { error.value = e.message } finally { guardando.value = false }
}

// El eliminar vive en el cajón de edición, que es donde se edita todo lo demás.
function eliminar() {
  const c = editando.value
  if (!c) return
  if (conAsignacion(c)) {
    err(`No se puede eliminar: ${c.nombre} tiene ${c.activos} activo(s) y ${c.utiles} útil(es) asignados`)
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
      mostrar.value = false
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
        <p class="muted">{{ lista.length }} responsable(s) · {{ totalActivos }} activo(s) y {{ totalUtiles }} útil(es) asignado(s)</p>
      </div>
      <span class="btns">
        <button class="btn sec" title="Acta de responsabilidad material: elige la persona y mira la vista previa" @click="abrirActa">
          <AppIcon name="file" :size="14" /> Acta
        </button>
        <button class="btn sec" title="Hoja de responsables y sus áreas: vista previa, imprimirla o bajarla en PDF/Excel" @click="verHoja">
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
        <thead><tr><th>Nombre</th><th>Áreas</th><th>Usuario</th><th>AFT</th><th>Útiles</th></tr></thead>
        <tbody>
          <!-- Toda la fila abre el cajón de edición: no hay botones Editar/Eliminar. -->
          <tr v-for="c in filtrados" :key="c.id" class="fila" @click="abrirEditar(c)">
            <td><b>{{ c.nombre }}</b></td>
            <td class="muted">{{ (c.areas || []).join(', ') || '—' }}</td>
            <td><span v-if="c.username" class="usr"><AppIcon name="user-check" :size="13" /> {{ c.username }}</span><span v-else class="muted">—</span></td>
            <td><span class="badge" :class="c.activos ? 'ok' : 'warn'">{{ c.activos }}</span></td>
            <td><span class="badge" :class="c.utiles ? 'ok' : ''">{{ c.utiles }}</span></td>
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
      <div class="field">
        <label>Carnet de Identidad</label>
        <input v-model="carnet" class="input" inputmode="numeric" placeholder="N.º de carnet (sale en el acta)" />
      </div>
      <div class="field">
        <label>Cargo</label>
        <input v-model="cargo" class="input" placeholder="Cargo u ocupación (sale en el acta)" />
      </div>
      <div class="field vinculo">
        <label>Usuario del sistema</label>
        <select v-model="userId" class="select">
          <option value="">Sin vincular</option>
          <option v-for="u in usuarios" :key="u.id" :value="u.id" :disabled="lista.some((c) => c.user_id === u.id && c.id !== editando?.id)">{{ u.username }}{{ u.nombre ? ' — ' + u.nombre : '' }}</option>
        </select>
      </div>
      <template #pie>
        <button v-if="editando" class="btn danger" :disabled="conAsignacion(editando)" :title="conAsignacion(editando) ? 'Tiene activos o útiles asignados' : 'Eliminar responsable'" @click="eliminar">
          <AppIcon name="trash" :size="15" /> Eliminar
        </button>
        <button class="btn sec" @click="mostrar = false">Cancelar</button>
        <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
      </template>
    </Drawer>

    <!-- Acta: cajón de opciones (quién firma) con su hoja pegada al lado izquierdo. -->
    <Drawer :open="actaAbierto" titulo="Acta de responsabilidad material" subtitulo="Elige la persona" @close="cerrarActa">
      <div class="form-grid una">
        <div class="field"><label>Responsable</label>
          <select v-model="actaSel" class="select">
            <option value="">Elige la persona</option>
            <option v-for="c in lista" :key="c.id" :value="c.id">{{ c.nombre }}</option>
          </select>
          <small v-if="!actaSel" class="muted">Elige quién firma: la hoja se pide en cuanto selecciones.</small>
          <small v-else class="muted">El acta sale con su nombre, su carnet y su cargo, y los conteos de la BD. Si no tiene carnet ni cargo guardados, esos huecos se rellenan a mano.</small>
        </div>
      </div>
      <template #pie>
        <button class="btn sec" @click="cerrarActa">Cancelar</button>
        <button class="btn sec" :disabled="preview.cargando || !actaSel" title="Ver el acta antes de exportarlo" @click="verActaPreview">
          <AppIcon name="eye" :size="15" /> {{ preview.cargando ? 'Generando…' : 'Vista previa' }}
        </button>
        <button class="btn" :disabled="!preview.url" @click="descargarPdf"><AppIcon name="file" :size="15" /> PDF</button>
      </template>
    </Drawer>

    <!-- Vista previa de un PDF del servidor: hoja de responsables o acta de un responsable. -->
    <Drawer :open="preview.abierta" :titulo="tituloPreview" subtitulo="Tal como se imprimirá" :ancho="860" clase="preview-drawer" :extra="extraPreview" :sinClose="true" @close="preview.cerrar">
      <div class="preview-caja">
        <iframe v-if="preview.url" ref="visorPdf" class="preview-iframe" :src="preview.url" title="Vista previa de la hoja"></iframe>
        <div v-else class="center"><span class="spinner"></span></div>
      </div>
      <template #pie>
        <button class="btn sec" :disabled="!preview.url" @click="descargarPdf"><AppIcon name="file" :size="15" /> PDF</button>
        <!-- El acta no tiene su parte en Excel: ese botón es del listado. -->
        <button v-if="tipoPreview === 'hoja'" class="btn sec" :disabled="exportandoXls" @click="exportarExcel"><AppIcon name="file" :size="15" /> {{ exportandoXls ? 'Generando…' : 'Excel' }}</button>
        <button class="btn" :disabled="!preview.url" @click="preview.imprimir(visorPdf)"><AppIcon name="printer" :size="15" /> Imprimir</button>
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
.vacio { text-align: center; color: var(--muted); padding: 28px 12px; }
.vinculo { margin-top: 12px; }
.usr { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--primary-dark); }
.fila { cursor: pointer; }
.fila:hover { background: color-mix(in srgb, var(--primary) 5%, transparent); }

/* Vista previa de la hoja: el documento dentro del cajón, con su papel gris. */
.elige-acta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-bottom: 10px; }
.elige-acta label { font-weight: 600; white-space: nowrap; }
.elige-acta .select { flex: 1; }
.preview-caja {
  flex: 1; min-height: 0;
  background: #e2e8f0; border: 1px solid var(--border); border-radius: 10px;
  overflow: hidden; display: grid; place-items: center;
}
.preview-iframe { width: 100%; height: 100%; border: 0; background: #fff; }
</style>
