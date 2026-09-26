<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import QRCode from 'qrcode'
import { api, formatMoneda, getUser } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { usePreviewPdf } from '../previewPdf'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'

const activos = ref([])
const catalogo = ref({ categorias: [], areas: [], ubicaciones: [], custodios: [], marcas: [] })
const loading = ref(true)
const errores = ref('')

const q = ref('')
const fCategoria = ref('')
const fArea = ref('')
const fUbicacion = ref('')
const fResponsable = ref('')
const fEstado = ref('')

const filtrosAplicados = ref({})
const total = ref(0)
const pagina = ref(1)
const porPagina = ref(50)

const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / porPagina.value)))

// Quién entra por Accesos queda asignado a una sucursal; si esa sucursal no
// está en la base, entra pero no ve nada (y hay que decírselo).
const usuario = computed(() => getUser() || {})
const sinDatos = computed(() => !!usuario.value.sinDatos)
const esGlobal = computed(() => usuario.value.rol === 'admin')
// Los dos roles globales ven las ocho sucursales; el resto, la suya.
const sucursalTexto = computed(() => {
  if (esGlobal.value) return 'todas las sucursales'
  return usuario.value.sucursalNombre || usuario.value.sucursal || 'sin sucursal'
})

const mostrar = ref(false)
const formulario = ref({})
const guardando = ref(false)

const exportandoPdf = ref(false)
const conteoAbierto = ref(false)
const conteo = ref({ formato: 'pdf', area: '', ubicacion: '', responsable: '', separar: '', numero: '', periodo: '' })
const qrAbierto = ref(false)
const qrImagenes = ref([])
const qrTotal = ref(0)
const generandoQr = ref(false)

const histDrawer = ref(false)
const movimientos = ref([])
const cargandoMov = ref(false)

const user = computed(() => getUser())
const esAdmin = computed(() => user.value?.rol === 'admin')

const filasCompactas = ref(localStorage.getItem('aft_compact') === '1')
const drawerAbierto = ref(false)
const activoSel = ref(null)
const editDrawer = ref(false)

function toggleCompacto() {
  filasCompactas.value = !filasCompactas.value
  localStorage.setItem('aft_compact', filasCompactas.value ? '1' : '0')
}

function abrirActivo(a) {
  activoSel.value = a
  editDrawer.value = false
  histDrawer.value = false
  drawerAbierto.value = true
}

function cerrarDrawer() {
  drawerAbierto.value = false
  editDrawer.value = false
  histDrawer.value = false
  activoSel.value = null
}

function editarDrawer() {
  const a = activoSel.value
  if (!a) return
  errores.value = ''
  formulario.value = {
    codigo: a.codigo || '', descripcion: a.descripcion, marca_id: a.marca_id || '',
    modelo: a.modelo || '', valor_cup: a.valor_cup ?? '', valor_usd: a.valor_usd ?? '',
    categoria_id: a.categoria_id || '', sucursal_id: a.sucursal_id || 1,
    fecha_adquisicion: a.fecha_adquisicion || '', ubicacion_id: a.ubicacion_id || '',
    custodio_id: a.custodio_id || '', estado: a.estado || 'ACTIVO', comentarios: a.comentarios || ''
  }
  editDrawer.value = true
}

function eliminarDrawer() {
  const a = activoSel.value
  cerrarDrawer()
  if (a) eliminar(a)
}

const ESTADOS = ['ACTIVO', 'BAJA']

const ubicacionesDe = (areaId) => (areaId
  ? catalogo.value.ubicaciones.filter((u) => u.area_id === Number(areaId))
  : catalogo.value.ubicaciones)
const ubicacionesFiltro = computed(() => ubicacionesDe(fArea.value))
const ubicacionesConteo = computed(() => ubicacionesDe(conteo.value.area))

function cambiarArea() {
  if (fUbicacion.value && !ubicacionesFiltro.value.some((u) => u.id === Number(fUbicacion.value))) fUbicacion.value = ''
  aplicar()
}

const nome = (lista, id) => lista.find((x) => x.id === Number(id))?.nombre || ''
const areaDe = (id) => catalogo.value.areas.find((x) => x.id === Number(id))?.etiqueta || ''

const chips = computed(() => {
  const f = filtrosAplicados.value
  const out = []
  if (f.q) out.push({ k: 'q', texto: `«${f.q}»` })
  if (f.categoria) out.push({ k: 'categoria', texto: nome(catalogo.value.categorias, f.categoria) })
  if (f.area) out.push({ k: 'area', texto: areaDe(f.area) })
  if (f.ubicacion) out.push({ k: 'ubicacion', texto: nome(catalogo.value.ubicaciones, f.ubicacion) })
  if (f.custodio) out.push({ k: 'custodio', texto: nome(catalogo.value.custodios, f.custodio) })
  if (f.estado) out.push({ k: 'estado', texto: f.estado })
  return out
})

function emptyForm() {
  return {
    codigo: '', descripcion: '', marca_id: '', modelo: '', valor_cup: '', valor_usd: '',
    categoria_id: '', sucursal_id: 1, fecha_adquisicion: '', ubicacion_id: '',
    custodio_id: '', estado: 'ACTIVO', comentarios: ''
  }
}

function filtrosQuery() {
  const params = new URLSearchParams()
  if (filtrosAplicados.value.q) params.set('q', filtrosAplicados.value.q)
  if (filtrosAplicados.value.categoria) params.set('categoria', filtrosAplicados.value.categoria)
  if (filtrosAplicados.value.area) params.set('area', filtrosAplicados.value.area)
  if (filtrosAplicados.value.ubicacion) params.set('ubicacion', filtrosAplicados.value.ubicacion)
  if (filtrosAplicados.value.custodio) params.set('custodio', filtrosAplicados.value.custodio)
  if (filtrosAplicados.value.estado) params.set('estado', filtrosAplicados.value.estado)
  return params
}

async function cargar() {
  loading.value = true
  errores.value = ''
  try {
    const params = filtrosQuery()
    params.set('limite', String(porPagina.value))
    params.set('offset', String((pagina.value - 1) * porPagina.value))
    const res = await api.get('/api/activos?' + params.toString())
    activos.value = res.activos
    total.value = res.total
    if (total.value && pagina.value > totalPaginas.value) pagina.value = totalPaginas.value
  } catch (e) { errores.value = e.message } finally { loading.value = false }
}

async function cargarCatalogo() {
  catalogo.value = await api.get('/api/catalogo')
}

function aplicar() {
  pagina.value = 1
  filtrosAplicados.value = { q: q.value.trim(), categoria: fCategoria.value, area: fArea.value, ubicacion: fUbicacion.value, custodio: fResponsable.value, estado: fEstado.value }
  cargar()
}

function limpiar() {
  q.value = ''; fCategoria.value = ''; fArea.value = ''; fUbicacion.value = ''; fResponsable.value = ''; fEstado.value = ''
  filtrosAplicados.value = {}
  if (pagina.value !== 1) pagina.value = 1
  cargar()
}

function quitarChip(k) {
  if (k === 'q') q.value = ''
  if (k === 'categoria') fCategoria.value = ''
  if (k === 'area') fArea.value = ''
  if (k === 'ubicacion') fUbicacion.value = ''
  if (k === 'custodio') fResponsable.value = ''
  if (k === 'estado') fEstado.value = ''
  aplicar()
}

function irPagina(p) {
  if (p < 1 || p > totalPaginas.value) return
  pagina.value = p
  cargar()
}

function abrirNuevo() {
  formulario.value = emptyForm()
  mostrar.value = true
}

async function guardar() {
  guardando.value = true
  errores.value = ''
  try {
    const body = { ...formulario.value }
    for (const k of ['marca_id', 'categoria_id', 'sucursal_id', 'ubicacion_id', 'custodio_id']) {
      body[k] = body[k] ? Number(body[k]) : null
    }
    for (const k of ['valor_cup', 'valor_usd']) {
      body[k] = body[k] === '' ? null : Number(body[k])
    }
    if (!body.fecha_adquisicion) body.fecha_adquisicion = null
    const aid = mostrar.value ? null : activoSel.value?.id
    if (aid) {
      await api.put(`/api/activos/${aid}`, body)
      ok('Activo actualizado')
    } else {
      await api.post('/api/activos', body)
      ok('Activo creado')
    }
    mostrar.value = false
    editDrawer.value = false
    drawerAbierto.value = false
    cargar()
  } catch (e) { errores.value = e.message } finally { guardando.value = false }
}

function eliminar(a) {
  confirmar({
    titulo: 'Eliminar activo',
    mensaje: `¿Eliminar definitivamente "${a.codigo || a.descripcion}" — ${a.descripcion}? Esta acción no se puede deshacer.`,
    peligro: true
  }, async () => {
    try {
      await api.del(`/api/activos/${a.id}`)
      ok('Activo eliminado')
      cargar()
    } catch (e) { err(e.message) }
  })
}

// En escritorio la vista previa vive AL LADO del cajón de opciones, sin taparlo:
// se pide al abrir el cajón y se vuelve a pedir sola cuando cambian los datos.
// En móvil no cabe al lado, así que allí sigue siendo un botón.
const mqMovil = window.matchMedia('(max-width: 640px)')
const enMovil = ref(mqMovil.matches)
const onMovil = (e) => { enMovil.value = e.matches }
mqMovil.addEventListener('change', onMovil)
onBeforeUnmount(() => mqMovil.removeEventListener('change', onMovil))

function abrirConteo(formato) {
  const f = filtrosAplicados.value
  conteo.value = { ...conteo.value, formato, area: f.area || '', ubicacion: f.ubicacion || '', responsable: f.custodio || '' }
  conteoAbierto.value = true
  refrescarPreview(true)
}

function cambiarAreaConteo() {
  if (conteo.value.ubicacion && !ubicacionesConteo.value.some((u) => u.id === Number(conteo.value.ubicacion))) conteo.value.ubicacion = ''
}

// Los parámetros y el nombre del fichero salen de aquí, para que la vista previa
// y la descarga sean exactamente el mismo documento.
function paramsConteo() {
  const c = conteo.value
  const pdf = c.formato === 'pdf'
  const params = new URLSearchParams()
  if (c.area) params.set('area', c.area)
  if (c.ubicacion) params.set('ubicacion', c.ubicacion)
  if (c.responsable) params.set('custodio', c.responsable)
  if (c.separar) params.set('separar', c.separar)
  if (pdf && c.numero) params.set('conteo', c.numero)
  if (pdf && c.periodo.trim()) params.set('periodo', c.periodo.trim())
  return params
}

function nombreConteo() {
  const c = conteo.value
  const pdf = c.formato === 'pdf'
  const parte = [
    c.ubicacion ? nome(catalogo.value.ubicaciones, c.ubicacion) : c.area ? areaDe(c.area) : '',
    c.responsable ? nome(catalogo.value.custodios, c.responsable) : ''
  ].filter(Boolean).join('-')
  return (pdf ? 'Conteo-fisico' : 'AFT-Camaguey') + (parte ? '-' + parte.replace(/\s+/g, '_') : '') + '-' + new Date().toISOString().slice(0, 10) + (pdf ? '.pdf' : '.xlsx')
}

async function exportar() {
  exportandoPdf.value = true
  try {
    const pdf = conteo.value.formato === 'pdf'
    const qs = paramsConteo().toString()
    await api.download('/api/activos/export' + (pdf ? '/pdf' : '') + (qs ? '?' + qs : ''), nombreConteo())
    ok(pdf ? 'Hoja de conteo físico exportada a PDF' : 'Inventario exportado a Excel')
    cerrarConteo()
  } catch (e) { err(e.message) } finally { exportandoPdf.value = false }
}

// Vista previa: el MISMO PDF que se descargaría, enseñado en su propio cajón,
// al lado del de opciones.
const preview = usePreviewPdf()

let qsPreview = ''
let tPreview = null

async function previsualizar() {
  const qs = paramsConteo().toString()
  await preview.abrir('/api/activos/export/pdf' + (qs ? '?' + qs : ''))
}

// La vista previa se refresca sola cuando cambian los datos, pero sólo si de
// verdad cambiaron los parámetros: si no, escribir en «Período» reharía el PDF
// en cada tecla.
function refrescarPreview(inmediato) {
  // En Excel no hay hoja que enseñar: si estaba abierta, se cierra.
  if (conteo.value.formato !== 'pdf') { qsPreview = ''; preview.cerrar(); return }
  if (enMovil.value || !conteoAbierto.value) return
  const qs = paramsConteo().toString()
  if (qs === qsPreview) return
  clearTimeout(tPreview)
  const pedir = () => { qsPreview = qs; previsualizar() }
  if (inmediato) pedir()
  else tPreview = setTimeout(pedir, 350)
}
watch(conteo, () => refrescarPreview(false), { deep: true })
onBeforeUnmount(() => clearTimeout(tPreview))

// Los dos cajones van juntos: se abren y se cierran como una sola cosa.
function cerrarConteo() {
  conteoAbierto.value = false
  qsPreview = ''
  preview.cerrar()
}

function ponerFormato(f) {
  conteo.value.formato = f
  if (f !== 'pdf') { qsPreview = ''; preview.cerrar(); return }
  qsPreview = ''
  refrescarPreview(true)
}

// En móvil la vista previa se pide con el botón y se encima al cajón de opciones.
async function verPreview() {
  await previsualizar()
  if (preview.abierta) conteoAbierto.value = false
}

async function generarEtiquetas() {
  qrAbierto.value = true
  generandoQr.value = true
  qrImagenes.value = []
  try {
    const qs = filtrosQuery().toString()
    const res = await api.get('/api/activos' + (qs ? '?' + qs + '&' : '?') + 'limite=1000')
    qrTotal.value = res.total
    const imgs = await Promise.all(res.activos.map(async (a) => {
      const linea = `${a.codigo || ('ID ' + a.id)}\n${a.descripcion}\n${a.marca || ''} ${a.modelo || ''}`.trim()
      return { ...a, qr: await QRCode.toDataURL(linea, { margin: 1, width: 320 }) }
    }))
    qrImagenes.value = imgs
  } catch (e) { errores.value = 'No se pudieron generar las etiquetas: ' + e.message }
  finally { generandoQr.value = false }
}

function imprimir() { window.print() }

async function verHistorial(a) {
  histDrawer.value = true
  cargandoMov.value = true
  movimientos.value = []
  try {
    const res = await api.get(`/api/activos/${a.id}/movimientos`)
    movimientos.value = res.movimientos
  } catch (e) { errores.value = e.message } finally { cargandoMov.value = false }
}

function flecha(x, y) { return ` ${x || '—'} → ${y || '—'} ` }

function descMov(m) {
  switch (m.tipo) {
    case 'CREADO': return 'Registro inicial' + (m.ubicacion_destino ? ` — ubicación: ${m.ubicacion_destino}` : '') + (m.custodio_destino ? `, custodio: ${m.custodio_destino}` : '') + (m.estado_destino ? `, estado: ${m.estado_destino}` : '')
    case 'TRASLADO_UBICACION': return 'Traslado de ubicación: ' + flecha(m.ubicacion_origen, m.ubicacion_destino)
    case 'CAMBIO_CUSTODIO': return 'Cambio de custodio: ' + flecha(m.custodio_origen, m.custodio_destino)
    case 'CAMBIAR_ESTADO': return 'Estado: ' + flecha(m.estado_origen, m.estado_destino)
    default: return m.tipo
  }
}

function tipoBadge(m) {
  if (m.tipo === 'CREADO') return 'ok'
  return 'warn'
}

function fmtFecha(iso) {
  return new Date(iso).toLocaleString('es-CU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => { cargarCatalogo().then(cargar).catch(() => {}) })
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h2>Inventario de Activos</h2>
        <p class="muted">{{ total }} registro(s) · {{ sucursalTexto }} · <span class="hint">toca una fila para ver todos los detalles</span></p>
      </div>
      <span class="btns">
        <button class="btn sec sm" :class="{ on: filasCompactas }" @click="toggleCompacto" :title="filasCompactas ? 'Filas normales' : 'Filas compactas (ver más registros)'"><AppIcon name="rows" :size="15" /> <span class="hbt">Compacto</span></button>
        <button class="btn sec sm" @click="abrirConteo('excel')" title="Inventario en Excel, por área o ubicación"><AppIcon name="file" :size="15" /> Excel</button>
        <button class="btn sec sm" :disabled="exportandoPdf || !total" @click="abrirConteo('pdf')" title="Hoja de conteo físico en PDF, por área o ubicación"><AppIcon name="file" :size="15" /> PDF</button>
        <button class="btn sec sm" :disabled="!total" @click="generarEtiquetas" title="Generar etiquetas QR de los activos filtrados"><AppIcon name="qr" :size="15" /> QR</button>
        <button class="btn sm" @click="abrirNuevo"><AppIcon name="plus" :size="15" /> Nuevo activo</button>
      </span>
    </div>

    <div class="card filtros">
      <input v-model="q" class="input" placeholder="Buscar por descripción, modelo, código…" @keyup.enter="aplicar" />
      <select v-model="fCategoria" class="select" @change="aplicar"><option value="">Categoría</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="fArea" class="select" @change="cambiarArea"><option value="">Área</option><option v-for="a in catalogo.areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option></select>
      <select v-model="fUbicacion" class="select" @change="aplicar"><option value="">Ubicación</option><option v-for="u in ubicacionesFiltro" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}</option></select>
      <select v-model="fResponsable" class="select" @change="aplicar"><option value="">Responsable</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="fEstado" class="select" @change="aplicar"><option value="">Estado</option><option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option></select>
      <span class="btns">
        <button class="btn sm" @click="aplicar">Filtrar</button>
        <button class="btn sec sm" @click="limpiar">Limpiar</button>
      </span>
    </div>

    <div v-if="chips.length" class="chips">
      <span v-for="c in chips" :key="c.k" class="chip">
        {{ c.texto }} <button class="chip-x" title="Quitar filtro" @click="quitarChip(c.k)"><AppIcon name="x" :size="12" /></button>
      </span>
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="errores" class="err">{{ errores }}</p>

    <div v-else-if="!activos.length" class="card vacio">
      <AppIcon name="box" :size="44" />
      <template v-if="sinDatos">
        <p v-if="usuario.sucursalNombre">Tu sucursal ({{ usuario.sucursalNombre }}) todavía no tiene datos en este sistema.</p>
        <p v-else>Entraste sin sucursal asignada en este sistema.</p>
        <p class="hint">Aquí sólo se gestionan los datos de la sucursal Camagüey. Pide al administrador que dé de alta la tuya.</p>
      </template>
      <p v-else>No hay activos{{ total ? ' con los filtros aplicados' : ' registrados todavía' }}.</p>
      <button v-if="total" class="btn sec sm" @click="limpiar">Limpiar filtros</button>
    </div>

    <template v-else>
      <div class="card table-wrap">
        <table class="tbl" :class="{ compact: filasCompactas }">
          <thead>
            <tr><th>Código</th><th>Descripción</th><th>Marca</th><th>Ubicación</th><th>Responsable</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <template v-for="a in activos" :key="a.id">
              <tr :class="{ 'fila-act': activoSel?.id === a.id }" @click="abrirActivo(a)">
                <td><b class="codigo">{{ a.codigo || '—' }}</b></td>
                <td><b>{{ a.descripcion }}</b></td>
                <td>{{ a.marca || '—' }}</td>
                <td><span v-if="a.ubicacion" class="ubicacion"><span class="ubicacion-id">#{{ a.ubicacion_id }}</span> {{ a.ubicacion }}</span><span v-else>—</span></td>
                <td>{{ a.custodio || '—' }}</td>
                <td><span class="badge" :class="a.estado === 'ACTIVO' ? 'ok' : 'warn'">{{ a.estado }}</span></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="paginacion">
        <label class="pag-lbl">Por página</label>
        <select v-model="porPagina" class="select pag-size" @change="pagina = 1; cargar()">
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
        </select>
        <span class="pg-info">Página {{ pagina }} de {{ totalPaginas }} · {{ total }} registros</span>
        <span class="pg-btns">
          <button class="btn sec sm" :disabled="pagina <= 1" @click="irPagina(pagina - 1)">‹ Anterior</button>
          <button class="btn sec sm" :disabled="pagina >= totalPaginas" @click="irPagina(pagina + 1)">Siguiente ›</button>
        </span>
      </div>
    </template>

    <Drawer :open="drawerAbierto" :ancho="420" @close="cerrarDrawer">
      <template #antes-titulo>
        <button v-if="histDrawer" class="back" title="Volver al detalle" @click="histDrawer = false"><AppIcon name="arrow-left" :size="16" /></button>
      </template>
      <template #titulo>
        <template v-if="activoSel && histDrawer">
          <b>Historial</b>
          <span class="dw-sub">{{ activoSel.codigo || 'ID ' + activoSel.id }} — {{ activoSel.descripcion }}</span>
        </template>
        <template v-else-if="activoSel && editDrawer">
          <b>Editar activo</b>
          <span class="dw-sub">{{ activoSel.codigo || 'ID ' + activoSel.id }}</span>
        </template>
        <template v-else-if="activoSel">
          <b class="codigo">{{ activoSel.codigo || 'ID ' + activoSel.id }}</b>
          <span class="dw-sub">{{ activoSel.descripcion }}</span>
        </template>
      </template>
      <template v-if="activoSel">
        <p v-if="errores" class="err">{{ errores }}</p>
        <div v-if="histDrawer">
          <div v-if="cargandoMov" class="center"><span class="spinner"></span></div>
          <p v-else-if="!movimientos.length" class="muted">Sin movimientos registrados.</p>
          <div v-else class="timeline">
            <div v-for="m in movimientos" :key="m.id" class="tl-item">
              <div class="tl-dot"></div>
              <div class="tl-body">
                <div class="tl-head">
                  <span class="badge" :class="tipoBadge(m)">{{ m.tipo.replace(/_/g, ' ') }}</span>
                  <span class="muted tl-fecha">{{ fmtFecha(m.created_at) }}</span>
                </div>
                <p class="tl-desc">{{ descMov(m) }}</p>
                <p v-if="m.comentario" class="muted">«{{ m.comentario }}»</p>
              </div>
            </div>
          </div>
        </div>
        <template v-else-if="editDrawer">
          <div class="form-grid una">
            <div class="field"><label>Código</label><input v-model="formulario.codigo" class="input" placeholder="En blanco = automático" /></div>
            <div class="field"><label>Estado</label>
              <select v-model="formulario.estado" class="select"><option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option></select>
            </div>
            <div class="field full"><label>Descripción *</label><input v-model="formulario.descripcion" class="input" required /></div>
            <div class="field"><label>Marca</label>
              <select v-model="formulario.marca_id" class="select"><option value="">—</option><option v-for="m in catalogo.marcas" :key="m.id" :value="m.id">{{ m.nombre }}</option></select>
            </div>
            <div class="field"><label>Modelo</label><input v-model="formulario.modelo" class="input" /></div>
            <div class="field"><label>Categoría</label>
              <select v-model="formulario.categoria_id" class="select"><option value="">—</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
            </div>
            <div class="field"><label>Ubicación</label>
              <select v-model="formulario.ubicacion_id" class="select"><option value="">—</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}{{ u.area_id ? ' — ' + areaDe(u.area_id) : '' }}</option></select>
            </div>
            <div class="field"><label>Responsable</label>
              <select v-model="formulario.custodio_id" class="select"><option value="">—</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
            </div>
            <div class="field"><label>Fecha de adquisición</label><input v-model="formulario.fecha_adquisicion" class="input" placeholder="dd-mm-año" /></div>
            <div class="field"><label>Valor CUP</label><input v-model="formulario.valor_cup" type="number" step="0.01" class="input" /></div>
            <div class="field"><label>Valor USD</label><input v-model="formulario.valor_usd" type="number" step="0.01" class="input" /></div>
            <div class="field full"><label>Comentarios</label><textarea v-model="formulario.comentarios" class="textarea" rows="3"></textarea></div>
          </div>
        </template>
        <template v-else>
          <div class="det-grid">
            <div class="det"><span>Estado</span><span class="badge" :class="activoSel.estado === 'ACTIVO' ? 'ok' : 'warn'">{{ activoSel.estado }}</span></div>
            <div class="det"><span>Categoría</span><b>{{ activoSel.categoria || '—' }}</b></div>
            <div class="det"><span>Sucursal</span><b>{{ activoSel.sucursal || '—' }}</b></div>
            <div class="det"><span>Marca</span><b>{{ activoSel.marca || '—' }}</b></div>
            <div class="det"><span>Modelo</span><b>{{ activoSel.modelo || '—' }}</b></div>
            <div class="det"><span>Área</span><b>{{ activoSel.area || '—' }}</b></div>
            <div class="det"><span>Ubicación</span><b><span v-if="activoSel.ubicacion_id" class="ubicacion-id">#{{ activoSel.ubicacion_id }}</span> {{ activoSel.ubicacion || '—' }}</b></div>
            <div class="det"><span>Responsable</span><b>{{ activoSel.custodio || '—' }}</b></div>
            <div class="det"><span>Valor CUP</span><b>{{ formatMoneda(activoSel.valor_cup) }}</b></div>
            <div class="det"><span>Valor USD</span><b>{{ formatMoneda(activoSel.valor_usd) }}</b></div>
            <div class="det"><span>Fecha de adquisición</span><b>{{ activoSel.fecha_adquisicion || '—' }}</b></div>
            <div class="det"><span>Creado</span><b>{{ fmtFecha(activoSel.created_at) }}</b></div>
            <div class="det wide"><span>Comentarios</span><b>{{ activoSel.comentarios || '—' }}</b></div>
          </div>
        </template>
      </template>
      <template #pie>
        <template v-if="histDrawer">
          <button class="btn sec" @click="histDrawer = false"><AppIcon name="arrow-left" :size="15" /> Volver al detalle</button>
          <button class="btn sec" @click="cerrarDrawer">Cerrar</button>
        </template>
        <template v-else-if="editDrawer">
          <button class="btn sec" @click="editDrawer = false">Cancelar</button>
          <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar cambios' }}</button>
        </template>
        <template v-else>
          <button class="btn sec" @click="verHistorial(activoSel)"><AppIcon name="clock" :size="15" /> Historial</button>
          <button class="btn sec" @click="editarDrawer"><AppIcon name="edit" :size="15" /> Editar</button>
          <button v-if="esAdmin" class="btn danger" @click="eliminarDrawer"><AppIcon name="trash" :size="15" /> Eliminar</button>
        </template>
      </template>
    </Drawer>

    <Drawer :open="mostrar" titulo="Nuevo activo" @close="mostrar = false">
      <p v-if="errores" class="err">{{ errores }}</p>
      <div class="form-grid una">
        <div class="field"><label>Código</label><input v-model="formulario.codigo" class="input" placeholder="En blanco = automático" /></div>
        <div class="field"><label>Estado</label>
          <select v-model="formulario.estado" class="select"><option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option></select>
        </div>
        <div class="field full"><label>Descripción *</label><input v-model="formulario.descripcion" class="input" required /></div>
        <div class="field"><label>Marca</label>
          <select v-model="formulario.marca_id" class="select"><option value="">—</option><option v-for="m in catalogo.marcas" :key="m.id" :value="m.id">{{ m.nombre }}</option></select>
        </div>
        <div class="field"><label>Modelo</label><input v-model="formulario.modelo" class="input" /></div>
        <div class="field"><label>Categoría</label>
          <select v-model="formulario.categoria_id" class="select"><option value="">—</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
        </div>
        <div class="field"><label>Ubicación</label>
          <select v-model="formulario.ubicacion_id" class="select"><option value="">—</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}{{ u.area_id ? ' — ' + areaDe(u.area_id) : '' }}</option></select>
        </div>
        <div class="field"><label>Responsable</label>
          <select v-model="formulario.custodio_id" class="select"><option value="">—</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
        </div>
        <div class="field"><label>Fecha de adquisición</label><input v-model="formulario.fecha_adquisicion" class="input" placeholder="dd-mm-año" /></div>
        <div class="field"><label>Valor CUP</label><input v-model="formulario.valor_cup" type="number" step="0.01" class="input" /></div>
        <div class="field"><label>Valor USD</label><input v-model="formulario.valor_usd" type="number" step="0.01" class="input" /></div>
        <div class="field full"><label>Comentarios</label><textarea v-model="formulario.comentarios" class="textarea" rows="2"></textarea></div>
      </div>
      <template #pie>
        <button class="btn sec" @click="mostrar = false">Cancelar</button>
        <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
      </template>
    </Drawer>

    <Drawer :open="conteoAbierto" :titulo="conteo.formato === 'pdf' ? 'Hoja de conteo físico' : 'Exportar a Excel'" subtitulo="Todo, por área, ubicación o responsable" @close="cerrarConteo">
      <div class="formato">
        <button class="btn sec sm" :class="{ on: conteo.formato === 'pdf' }" @click="ponerFormato('pdf')">PDF · conteo físico</button>
        <button class="btn sec sm" :class="{ on: conteo.formato === 'excel' }" @click="ponerFormato('excel')">Excel · inventario</button>
      </div>
      <div class="form-grid una">
        <div class="field"><label>Área</label>
          <select v-model="conteo.area" class="select" @change="cambiarAreaConteo"><option value="">Todas las áreas</option><option v-for="a in catalogo.areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option></select>
        </div>
        <div class="field"><label>Ubicación</label>
          <select v-model="conteo.ubicacion" class="select"><option value="">{{ conteo.area ? 'Todas las del área' : 'Todas las ubicaciones' }}</option><option v-for="u in ubicacionesConteo" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}</option></select>
        </div>
        <div class="field"><label>Responsable</label>
          <select v-model="conteo.responsable" class="select"><option value="">Todos los responsables</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
        </div>
        <div class="field"><label>Separar</label>
          <select v-model="conteo.separar" class="select">
            <option value="">Todo junto</option>
            <option value="ubicacion">Cada ubicación por separado</option>
            <option value="responsable">Cada responsable por separado</option>
          </select>
          <small v-if="conteo.separar" class="muted">{{ conteo.formato === 'pdf' ? 'Sus propias páginas, con sus firmas,' : 'Una hoja del libro' }} por {{ conteo.separar === 'responsable' ? 'responsable' : 'ubicación' }}.</small>
        </div>
        <template v-if="conteo.formato === 'pdf'">
          <div class="field"><label>No. de conteo</label><input v-model="conteo.numero" class="input" inputmode="numeric" placeholder="Opcional" /></div>
          <div class="field"><label>Período</label><input v-model="conteo.periodo" class="input" placeholder="En blanco = mes actual (p. ej. Septiembre / 2026)" /></div>
        </template>
      </div>
      <p class="muted nota">{{ conteo.formato === 'pdf' ? 'Salen sólo los activos en estado ACTIVO, agrupados por área y ubicación.' : 'Mismo formato que «Control de AFT cmg rev01.xlsx».' }}</p>
      <template #pie>
        <button class="btn sec" @click="cerrarConteo">Cancelar</button>
        <button v-if="conteo.formato === 'pdf' && enMovil" class="btn sec" :disabled="preview.cargando || !total" title="Ver la hoja antes de descargarla" @click="verPreview">
          <AppIcon name="eye" :size="15" /> {{ preview.cargando ? 'Generando…' : 'Vista previa' }}
        </button>
        <button class="btn" :disabled="exportandoPdf" @click="exportar"><AppIcon name="file" :size="15" /> {{ exportandoPdf ? 'Generando…' : (conteo.formato === 'pdf' ? 'Descargar PDF' : 'Descargar Excel') }}</button>
      </template>
    </Drawer>

    <Drawer :open="preview.abierta" titulo="Vista previa de la hoja" subtitulo="Tal como se imprimirá" :ancho="860" clase="preview-drawer" :extra="{ '--dw-pegado': '440px' }" @close="cerrarConteo">
      <div class="preview-caja">
        <iframe v-if="preview.url" class="preview-iframe" :src="preview.url" title="Vista previa de la hoja de conteo"></iframe>
        <div v-else class="center"><span class="spinner"></span></div>
      </div>
      <template #pie>
        <button class="btn sec" @click="cerrarConteo">Cerrar</button>
        <button class="btn sec" :disabled="!preview.url" @click="preview.descargar(nombreConteo())"><AppIcon name="file" :size="15" /> Descargar</button>
        <button class="btn" :disabled="!preview.url" @click="preview.imprimir"><AppIcon name="printer" :size="15" /> Imprimir</button>
      </template>
    </Drawer>

    <Drawer :open="qrAbierto" titulo="Etiquetas QR" :ancho="760" clase="qr-drawer" @close="qrAbierto = false">
      <p v-if="errores" class="err">{{ errores }}</p>
      <p class="muted">{{ qrImagenes.length }} etiqueta(s) de {{ qrTotal }} activo(s) que coinciden con el filtro.</p>
      <div v-if="generandoQr && !qrImagenes.length" class="center"><span class="spinner"></span></div>
      <div v-else class="qr-sheet">
        <div v-for="a in qrImagenes" :key="a.id" class="qr-label">
          <img :src="a.qr" alt="QR" />
          <div class="qr-info">
            <b>{{ a.codigo || ('ID ' + a.id) }}</b>
            <span class="mutado">{{ a.descripcion }}</span>
            <span class="mutado">{{ a.marca }}{{ a.modelo ? ' ' + a.modelo : '' }}</span>
          </div>
        </div>
      </div>
      <template #pie>
        <button class="btn sec" @click="qrAbierto = false">Cerrar</button>
        <button class="btn" :disabled="!qrImagenes.length" @click="imprimir"><AppIcon name="printer" :size="15" /> Imprimir</button>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
.head h2 { margin: 0; } .muted { color: var(--muted); margin: 4px 0 0; }
.hint { font-style: italic; opacity: 0.85; }
.head .btns { display: flex; gap: 8px; align-items: center; }
.codigo { color: var(--primary); font-variant-numeric: tabular-nums; }
.ubicacion-id {
  display: inline-block; margin-right: 4px; padding: 1px 6px;
  background: #eef4ff; color: var(--primary-dark); border: 1px solid #c9dcff;
  border-radius: 6px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.filtros { display: flex; gap: 10px; padding: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.filtros .input { flex: 1 1 220px; }
.filtros .select { flex: 0 1 200px; }
.filtros .btns { display: flex; gap: 6px; align-items: center; }

.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px;
  background: #eef4ff; color: var(--primary-dark); border: 1px solid #c9dcff;
  border-radius: 999px; font-size: 12px; font-weight: 600;
}
.chip-x { background: none; border: none; padding: 0; cursor: pointer; color: var(--primary-dark); display: flex; opacity: 0.6; }
.chip-x:hover { opacity: 1; }

.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }

.vacio { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px 20px; color: var(--muted); text-align: center; }
.vacio svg { color: #c4cbd8; }

.paginacion { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.pag-lbl { font-size: 12px; color: var(--muted); font-weight: 600; }
.pag-size { width: 80px; }
.pg-info { flex: 1; font-size: 12px; color: var(--muted); }
.pg-btns { display: flex; gap: 6px; }

.table-wrap { max-height: calc(100vh - 280px); overflow: auto; }
table.tbl thead th { position: sticky; top: 0; z-index: 2; }
table.tbl tbody tr { cursor: pointer; }
table.tbl tr.fila-act td { background: #eef4ff; }
table.tbl.compact th, table.tbl.compact td { padding: 5px 9px; font-size: 12.5px; }

.btn.on { background: #e0ecff; border-color: var(--primary); color: var(--primary-dark); }

.back { background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px; border-radius: 6px; display: flex; flex-shrink: 0; }
.back:hover { color: var(--primary); background: #eef4ff; }
.nota { font-size: 12px; margin-top: 14px; }

/* Vista previa del PDF: la hoja entera, con su fondo gris de papel. */
.preview-caja {
  height: calc(100dvh - 210px); min-height: 300px;
  background: #e2e8f0; border: 1px solid var(--border); border-radius: 10px;
  overflow: hidden; display: grid; place-items: center;
}
.preview-iframe { width: 100%; height: 100%; border: 0; background: #fff; }
.formato { display: flex; gap: 6px; margin-bottom: 14px; }
.formato .btn { flex: 1; justify-content: center; }

.det-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px 18px; }
.det { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.det > span { font-size: 10.5px; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }
.det > b { font-size: 13px; font-weight: 600; word-break: break-word; }
.det.wide { grid-column: 1 / -1; }

@media (max-width: 640px) {
  .hbt { display: none; }
}
</style>