<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { api, formatMoneda, getUser } from '../api'
import { getCatalogo, invalidarCatalogo } from '../catalogo'
import { construirDocumento, imprimirDocumento } from '../imprimir'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { usePreviewPdf } from '../previewPdf'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'

const activos = ref([])
const catalogo = ref({ categorias: [], areas: [], ubicaciones: [], custodios: [], marcas: [], responsablesPorArea: [] })
const loading = ref(true)
const errores = ref('')

const q = ref('')
const fCategoria = ref('')
const fArea = ref('')
const fResponsable = ref('')
const fEstado = ref('')

const filtrosAplicados = ref({})
/** ¿Se está mirando una lista recortada? Si no, ninguna fila puede caerse de ella. */
const hayFiltros = () => Object.values(filtrosAplicados.value).some((v) => v !== '' && v != null)
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
const exportandoExcel = ref(false)
const imprimiendo = ref(false)
const conteoAbierto = ref(false)
const conteo = ref({ area: '', responsable: '' })
const menuExcel = ref(false)
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
    fecha_adquisicion: a.fecha_adquisicion || '', area_id: a.area_id || '',
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


// Quién se puede elegir en un área: los que ya responden de activos en ella.
// Sin área elegida no hay lista: primero se dice de qué área hablamos.
function responsablesDe(areaId) {
  const todos = catalogo.value.responsablesPorArea || []
  const lista = areaId ? todos.filter((r) => r.area_id === Number(areaId)) : []
  const ya = new Map()
  for (const r of lista) if (!ya.has(r.custodio_id)) ya.set(r.custodio_id, r.nombre)
  return [...ya.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

const responsablesConteo = computed(() => responsablesDe(conteo.value.area))

/**
 * En el FILTRO, sin área se listan TODOS.
 *
 * Aquí el desplegable de responsable estaba apagado hasta elegir un área, y decía
 * «Primero elige el área». En el formulario eso tiene sentido —el servidor deduce la
 * ubicación a partir del área Y el responsable—, pero al FILTRAR no: «qué tiene
 * Alieski» es una pregunta entera por sí sola, y encima es uno de los cortes que ya
 * hace el exporte. Obligaba a saber de antemano en qué área está una persona, que es
 * justo lo que se viene a averiguar — y quien tiene cosas en dos áreas no se podía
 * mirar de una vez. Jose, 30/09/2026.
 *
 * Salen los que TIENEN activos y no el padrón entero: un responsable sin nada sólo
 * sirve para elegirlo y que la lista salga vacía.
 */
const responsablesFiltro = computed(() => {
  if (fArea.value) return responsablesDe(fArea.value)
  const ya = new Map()
  for (const r of catalogo.value.responsablesPorArea || []) {
    if (!ya.has(r.custodio_id)) ya.set(r.custodio_id, r.nombre)
  }
  return [...ya.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
})

// En el formulario se deja a la vista el responsable que ya trae el activo, por
// si no está en la lista del área: cambiar de área sí lo quita.
const responsablesForm = computed(() => {
  const lista = responsablesDe(formulario.value.area_id)
  const actual = formulario.value.custodio_id
  if (actual && !lista.some((r) => r.id === Number(actual))) lista.push({ id: Number(actual), nombre: nome(catalogo.value.custodios, actual) })
  return lista
})

// Cambiar de área deja el responsable de fuera: en otra área no le toca.
function fueraDeArea(lista, id) {
  return id && !lista.some((r) => r.id === Number(id))
}

function cambiarArea() {
  if (fueraDeArea(responsablesFiltro.value, fResponsable.value)) fResponsable.value = ''
  aplicar()
}

function cambiarAreaForm() {
  if (fueraDeArea(responsablesForm.value, formulario.value.custodio_id)) formulario.value.custodio_id = ''
}

const nome = (lista, id) => lista.find((x) => x.id === Number(id))?.nombre || ''
const areaDe = (id) => catalogo.value.areas.find((x) => x.id === Number(id))?.etiqueta || ''

const chips = computed(() => {
  const f = filtrosAplicados.value
  const out = []
  if (f.q) out.push({ k: 'q', texto: `«${f.q}»` })
  if (f.categoria) out.push({ k: 'categoria', texto: nome(catalogo.value.categorias, f.categoria) })
  if (f.area) out.push({ k: 'area', texto: areaDe(f.area) })
  if (f.custodio) out.push({ k: 'custodio', texto: nome(catalogo.value.custodios, f.custodio) })
  if (f.estado) out.push({ k: 'estado', texto: f.estado })
  return out
})

function emptyForm() {
  return {
    codigo: '', descripcion: '', marca_id: '', modelo: '', valor_cup: '', valor_usd: '',
    categoria_id: '', sucursal_id: 1, fecha_adquisicion: '', area_id: '',
    custodio_id: '', estado: 'ACTIVO', comentarios: ''
  }
}

function filtrosQuery() {
  const params = new URLSearchParams()
  if (filtrosAplicados.value.q) params.set('q', filtrosAplicados.value.q)
  if (filtrosAplicados.value.categoria) params.set('categoria', filtrosAplicados.value.categoria)
  if (filtrosAplicados.value.area) params.set('area', filtrosAplicados.value.area)
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
  catalogo.value = await getCatalogo()
}

// Se busca al escribir: no hay que dar Enter ni pulsar «Filtrar». Se espera un
// poco para no pedir la lista con cada tecla; Enter sigue buscando al momento.
let tBusqueda = null

function aplicar() {
  clearTimeout(tBusqueda)
  pagina.value = 1
  filtrosAplicados.value = { q: q.value.trim(), categoria: fCategoria.value, area: fArea.value, custodio: fResponsable.value, estado: fEstado.value }
  cargar()
}

watch(q, () => {
  clearTimeout(tBusqueda)
  tBusqueda = setTimeout(aplicar, 350)
})

function limpiar() {
  q.value = ''; fCategoria.value = ''; fArea.value = ''; fResponsable.value = ''; fEstado.value = ''
  filtrosAplicados.value = {}
  if (pagina.value !== 1) pagina.value = 1
  cargar()
}

function quitarChip(k) {
  if (k === 'q') q.value = ''
  if (k === 'categoria') fCategoria.value = ''
  if (k === 'area') fArea.value = ''
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
    // La ubicación NO se manda: la decide el servidor con el área y el responsable
    // (así no hay forma de guardar un activo en una ubicación que no le toca).
    delete body.ubicacion_id
    for (const k of ['marca_id', 'categoria_id', 'sucursal_id', 'area_id', 'custodio_id']) {
      body[k] = body[k] ? Number(body[k]) : null
    }
    for (const k of ['valor_cup', 'valor_usd']) {
      body[k] = body[k] === '' ? null : Number(body[k])
    }
    if (!body.fecha_adquisicion) body.fecha_adquisicion = null
    const aid = mostrar.value ? null : activoSel.value?.id
    if (aid) {
      // El servidor devuelve el activo ya calculado: se pinta en la lista al
      // momento, sin pedir la lista entera otra vez (otra ida y vuelta de red).
      const fila = await api.put(`/api/activos/${aid}`, body)
      const i = activos.value.findIndex((x) => x.id === aid)
      if (i >= 0) activos.value[i] = fila
      activoSel.value = fila
      ok('Activo actualizado')
      /*
       * Y SI HAY FILTRO PUESTO, se vuelve a preguntar al servidor.
       *
       * Pintar la fila en sitio evita una ida y vuelta, pero da por hecho que la fila
       * sigue perteneciendo a lo que se está mirando, y editar es justo lo que puede
       * sacarla de ahí. Con el filtro «Área 3» puesto, mover el activo al Área 6 lo
       * dejaba en la lista —ya con el área nueva escrita al lado, que es lo raro— hasta
       * que alguien refrescaba a mano. Lo reportó Jose el 30/09/2026: «lo cambio y se
       * sigue quedando, tengo que refrescar».
       *
       * Se reconcilia con el servidor en vez de decidirlo aquí a propósito: repetir en
       * la pantalla la regla de qué entra y qué no en cada filtro es tener dos jueces
       * del mismo pleito, y el día que uno cambie el otro se queda mintiendo.
       *
       * Sin filtros no se pide nada: ahí la fila no se puede caer de ninguna lista.
       */
      if (hayFiltros()) await cargar()
    } else {
      await api.post('/api/activos', body)
      ok('Activo creado')
      await cargar()
    }
    mostrar.value = false
    editDrawer.value = false
    drawerAbierto.value = false
    // Guardar puede haber creado una ubicación nueva (ALMACEN 4): que la próxima
    // pantalla la vea sin tener que esperar a que caduque la caché del catálogo.
    invalidarCatalogo()
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
onBeforeUnmount(() => { clearTimeout(tBusqueda); mqMovil.removeEventListener('change', onMovil) })

function abrirConteo() {
  const f = filtrosAplicados.value
  // La selección se rellena con el filtro de la tabla.
  conteo.value = { area: f.area || '', responsable: f.custodio || '' }
  if (conteo.value.responsable && !responsablesConteo.value.some((r) => r.id === Number(conteo.value.responsable))) conteo.value.responsable = ''
  conteoAbierto.value = true
  refrescarPreview(true)
}

function cambiarAreaConteo() {
  // Los responsables que se listan son los de esa área: si el elegido no está,
  // se quita en vez de mandar al servidor un nombre que ya no corresponde.
  if (conteo.value.responsable && !responsablesConteo.value.some((r) => r.id === Number(conteo.value.responsable))) conteo.value.responsable = ''
}

// Una hoja de conteo no se imprime «con todo mezclado»: hay que decir de qué área
// y de quién es.
const listoParaPdf = computed(() => !!conteo.value.area && !!conteo.value.responsable)

// Los parámetros y el nombre del fichero salen de aquí, para que la vista previa
// y la descarga sean exactamente el mismo documento.
function paramsConteo() {
  const c = conteo.value
  const params = new URLSearchParams()
  if (c.area) params.set('area', c.area)
  if (c.responsable) params.set('custodio', c.responsable)
  return params
}

function nombreConteo() {
  const c = conteo.value
  const parte = [
    c.area ? areaDe(c.area) : '',
    c.responsable ? nome(catalogo.value.custodios, c.responsable) : ''
  ].filter(Boolean).join('-')
  return 'Conteo-fisico' + (parte ? '-' + parte.replace(/\s+/g, '_') : '') + '-' + new Date().toISOString().slice(0, 10) + '.pdf'
}

const nombreExcel = () => 'AFT-Camaguey-' + new Date().toISOString().slice(0, 10) + '.xlsx'

async function exportar() {
  if (!listoParaPdf.value) return
  exportandoPdf.value = true
  try {
    const qs = paramsConteo().toString()
    await api.download('/api/activos/export/pdf' + (qs ? '?' + qs : ''), nombreConteo())
    ok('Hoja de conteo físico exportada a PDF')
    cerrarConteo()
  } catch (e) { err(e.message) } finally { exportandoPdf.value = false }
}

// Al darle a «Excel» se despliegan las dos cosas que se pueden hacer con el
// inventario entero: llevarlo impreso o bajarlo en .xlsx. Ninguna de las dos
// pide elegir nada.
function elegirExcel(accion) {
  menuExcel.value = false
  accion()
}

async function descargarExcel() {
  if (exportandoExcel.value) return
  exportandoExcel.value = true
  try {
    await api.download('/api/activos/export', nombreExcel())
    ok('Inventario exportado a Excel')
  } catch (e) { err(e.message) } finally { exportandoExcel.value = false }
}

// El .xlsx no lo imprime el navegador: eso lo hace la hoja de cálculo. Aquí se
// imprime el listado entero, con las mismas columnas, en una hoja limpia (y desde
// el diálogo se puede guardar en PDF).
async function imprimirListado() {
  if (imprimiendo.value) return
  imprimiendo.value = true
  try {
    const res = await api.get('/api/activos?limite=100000&offset=0')
    imprimirDocumento(construirDocumento({
      titulo: 'Inventario de Activos Fijos',
      subtitulo: `${res.total} registro(s) · ${sucursalTexto.value}`,
      columnas: [
        { t: 'Código' }, { t: 'Descripción' }, { t: 'Marca' }, { t: 'Modelo' },
        { t: 'Área' }, { t: 'Responsable' }, { t: 'Estado' }
      ],
      filas: res.activos.map((a) => [a.codigo, a.descripcion, a.marca, a.modelo, a.area, a.custodio, a.estado])
    }))
  } catch (e) { err(e.message) } finally { imprimiendo.value = false }
}

// Vista previa: el MISMO PDF que se descargaría, enseñado en su propio cajón,
// al lado del de opciones.
const preview = usePreviewPdf()

let qsPreview = ''
let tPreview = null

async function previsualizar() {
  clearTimeout(tPreview) // por si quedaba una recarga programada
  const qs = paramsConteo().toString()
  qsPreview = qs
  await preview.abrir('/api/activos/export/pdf' + (qs ? '?' + qs : ''))
}

// `forzar` = pedirla siempre (al abrir el cajón o con el botón). Sin forzar sólo
// se refresca si la hoja sigue abierta y cambiaron los parámetros: si no, un
// cambio no debería reabrirla si la persona la acababa de cerrar.
function refrescarPreview(forzar) {
  // Sin área + responsable no se pide nada: la hoja no existe todavía.
  if (!listoParaPdf.value) { qsPreview = ''; preview.cerrar(); return }
  if (enMovil.value || !conteoAbierto.value) return
  if (!forzar && !preview.abierta) return
  const qs = paramsConteo().toString()
  if (!forzar && qs === qsPreview) return
  clearTimeout(tPreview)
  if (forzar) previsualizar()
  else tPreview = setTimeout(previsualizar, 350)
}
watch(conteo, () => refrescarPreview(false), { deep: true })
onBeforeUnmount(() => clearTimeout(tPreview))

// Cerrar el cajón de opciones se lleva la hoja con él (son la misma cosa). La ✕
// de la hoja sólo cierra la hoja: las opciones quedan abiertas para seguir
// tocándolas y el botón «Vista previa» del pie la vuelve a traer.
function cerrarConteo() {
  conteoAbierto.value = false
  preview.cerrar()
}

// Botón «Vista previa»: se habilita en cuanto hay área y responsable.
async function verPreview() {
  if (!listoParaPdf.value) return
  await previsualizar()
  // En móvil las dos no caben apiladas: al abrir la hoja se van las opciones.
  if (enMovil.value && preview.abierta) conteoAbierto.value = false
}

async function generarEtiquetas() {
  qrAbierto.value = true
  generandoQr.value = true
  qrImagenes.value = []
  try {
    // Se pide la librería sólo aquí: pesa ~30 kB y la pantalla de Inventario no
    // la necesita hasta que alguien abre las etiquetas QR.
    const { default: QRCode } = await import('qrcode')
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

// El tipo viene en el nombre de banco (TRASLADO_UBICACION…): aquí se enseña
// como se dice en la app.
function etiquetaMov(m) {
  switch (m.tipo) {
    case 'CREADO': return 'Registro inicial'
    case 'TRASLADO_UBICACION': return 'Cambio de área'
    case 'CAMBIO_CUSTODIO': return 'Cambio de responsable'
    case 'CAMBIAR_ESTADO': return 'Cambio de estado'
    default: return m.tipo
  }
}

function descMov(m) {
  switch (m.tipo) {
    case 'CREADO': return 'Registro inicial' + (m.area_destino ? ` — área: ${m.area_destino}` : '') + (m.custodio_destino ? `, responsable: ${m.custodio_destino}` : '') + (m.estado_destino ? `, estado: ${m.estado_destino}` : '')
    case 'TRASLADO_UBICACION': return 'Cambio de área: ' + flecha(m.area_origen, m.area_destino)
    case 'CAMBIO_CUSTODIO': return 'Cambio de responsable: ' + flecha(m.custodio_origen, m.custodio_destino)
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

// Las dos cosas a la vez: el catálogo no depende de la lista, y esperar a uno para
// pedir el otro era medio segundo de más en cada entrada a la pantalla.
onMounted(() => {
  cargar().catch(() => {})
  cargarCatalogo().catch(() => {})
})
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
        <span class="menu">
          <button class="btn sec sm" :aria-expanded="menuExcel" title="Inventario entero: imprimir o bajarlo en Excel" @click="menuExcel = !menuExcel"><AppIcon name="file" :size="15" /> Excel <AppIcon name="chevron-down" :size="13" /></button>
          <div v-if="menuExcel" class="menu-fondo" @click="menuExcel = false"></div>
          <div v-if="menuExcel" class="menu-lista">
            <button class="menu-op" :disabled="imprimiendo" @click="elegirExcel(imprimirListado)"><AppIcon name="printer" :size="15" /> {{ imprimiendo ? 'Preparando…' : 'Imprimir' }}</button>
            <button class="menu-op" :disabled="exportandoExcel" @click="elegirExcel(descargarExcel)"><AppIcon name="file" :size="15" /> {{ exportandoExcel ? 'Generando…' : 'Exportar .xlsx' }}</button>
          </div>
        </span>
        <button class="btn sec sm" :disabled="exportandoPdf || !total" @click="abrirConteo()" title="Hoja de conteo físico en PDF: hay que elegir área y responsable"><AppIcon name="file" :size="15" /> PDF</button>
        <button class="btn sec sm" :disabled="!total" @click="generarEtiquetas" title="Generar etiquetas QR de los activos filtrados"><AppIcon name="qr" :size="15" /> QR</button>
        <button class="btn sm" @click="abrirNuevo"><AppIcon name="plus" :size="15" /> Nuevo activo</button>
      </span>
    </div>

    <div class="card filtros">
      <input v-model="q" class="input" placeholder="Buscar por descripción, modelo, código…" @keyup.enter="aplicar" />
      <select v-model="fCategoria" class="select" @change="aplicar"><option value="">Categoría</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="fArea" class="select" @change="cambiarArea"><option value="">Área</option><option v-for="a in catalogo.areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option></select>
      <select v-model="fResponsable" class="select" @change="aplicar"><option value="">Responsable</option><option v-for="r in responsablesFiltro" :key="r.id" :value="r.id">{{ r.nombre }}</option></select>
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
            <tr><th>Código</th><th>Descripción</th><th>Marca</th><th>Área</th><th>Responsable</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <template v-for="a in activos" :key="a.id">
              <tr :class="{ 'fila-act': activoSel?.id === a.id }" @click="abrirActivo(a)">
                <td><b class="codigo">{{ a.codigo || '—' }}</b></td>
                <td><b>{{ a.descripcion }}</b></td>
                <td>{{ a.marca || '—' }}</td>
                <td><span v-if="a.area">{{ a.area }}</span><span v-else>—</span></td>
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
                  <span class="badge" :class="tipoBadge(m)">{{ etiquetaMov(m) }}</span>
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
            <div class="field"><label>Área</label>
              <select v-model="formulario.area_id" class="select" @change="cambiarAreaForm"><option value="">—</option><option v-for="a in catalogo.areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option></select>
            </div>
            <div class="field"><label>Responsable</label>
              <select v-model="formulario.custodio_id" class="select" :disabled="!formulario.area_id" :title="formulario.area_id ? '' : 'Primero elige el área'"><option value="">{{ formulario.area_id ? '—' : 'Primero elige el área' }}</option><option v-for="r in responsablesForm" :key="r.id" :value="r.id">{{ r.nombre }}</option></select>
            </div>
            <div class="field full"><small class="muted">El área y el responsable deciden dónde queda el activo. Si esa pareja todavía no existe, se guarda sola.</small></div>
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
        <div class="field"><label>Área</label>
          <select v-model="formulario.area_id" class="select" @change="cambiarAreaForm"><option value="">—</option><option v-for="a in catalogo.areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option></select>
        </div>
        <div class="field"><label>Responsable</label>
          <select v-model="formulario.custodio_id" class="select" :disabled="!formulario.area_id" :title="formulario.area_id ? '' : 'Primero elige el área'"><option value="">{{ formulario.area_id ? '—' : 'Primero elige el área' }}</option><option v-for="r in responsablesForm" :key="r.id" :value="r.id">{{ r.nombre }}</option></select>
        </div>
        <div class="field full"><small class="muted">El área y el responsable deciden dónde queda el activo. Si esa pareja todavía no existe, se guarda sola.</small></div>
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

    <Drawer :open="conteoAbierto" titulo="Hoja de conteo físico" subtitulo="Por área y responsable" @close="cerrarConteo">
      <!-- La hoja es de una sola persona: hay que decir de quién es. -->
      <div class="form-grid una">
        <div class="field"><label>Área</label>
          <select v-model="conteo.area" class="select" @change="cambiarAreaConteo"><option value="">Elige el área</option><option v-for="a in catalogo.areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option></select>
        </div>
        <div class="field"><label>Responsable</label>
          <select v-model="conteo.responsable" class="select" :disabled="!conteo.area">
            <option value="">{{ conteo.area ? 'Elige el responsable' : 'Primero elige el área' }}</option>
            <option v-for="r in responsablesConteo" :key="r.id" :value="r.id">{{ r.nombre }}</option>
          </select>
          <small v-if="!conteo.area" class="muted">Primero elige el área: sólo se enseñan sus responsables.</small>
          <small v-else-if="responsablesConteo.length === 0" class="muted">Sin responsables en esta área.</small>
          <small v-else-if="conteo.responsable" class="muted">Sale sólo lo suyo: nada de otros responsables. Él firma la hoja.</small>
        </div>
        <div class="field" v-if="!listoParaPdf"><small class="muted">Elige el área y el responsable: una hoja de conteo no se imprime con todo mezclado.</small></div>
      </div>
      <template #pie>
        <button class="btn sec" @click="cerrarConteo">Cancelar</button>
        <button class="btn sec" :disabled="preview.cargando || !listoParaPdf" title="Ver la hoja antes de exportarla" @click="verPreview">
          <AppIcon name="eye" :size="15" /> {{ preview.cargando ? 'Generando…' : 'Vista previa' }}
        </button>
        <button class="btn" :disabled="exportandoPdf || !listoParaPdf" @click="exportar"><AppIcon name="file" :size="15" /> {{ exportandoPdf ? 'Generando…' : 'Exportar PDF' }}</button>
      </template>
    </Drawer>

    <Drawer :open="preview.abierta" titulo="Vista previa de la hoja" subtitulo="Tal como se imprimirá" :ancho="860" clase="preview-drawer" :extra="{ '--dw-pegado': '440px' }" :sinClose="true" @close="preview.cerrar">
      <div class="preview-caja">
        <iframe v-if="preview.url" class="preview-iframe" :src="preview.url" title="Vista previa de la hoja de conteo"></iframe>
        <div v-else class="center"><span class="spinner"></span></div>
      </div>
      <template #pie>
        <button class="btn sec" :disabled="!preview.url" @click="preview.descargar(nombreConteo())"><AppIcon name="file" :size="15" /> Exportar</button>
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
  flex: 1; min-height: 0;
  background: #e2e8f0; border: 1px solid var(--border); border-radius: 10px;
  overflow: hidden; display: grid; place-items: center;
}
.preview-iframe { width: 100%; height: 100%; border: 0; background: #fff; }
/* Menú del botón Excel: se despliega bajo el botón y se cierra tocando fuera. */
.menu { position: relative; z-index: 30; display: inline-flex; }
.menu-fondo { position: fixed; inset: 0; z-index: 1; }
.menu-lista {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 2;
  min-width: 190px; padding: 6px; display: flex; flex-direction: column; gap: 2px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-lg);
}
.menu-op {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border: 0; background: none; border-radius: 8px;
  font-size: 13px; color: var(--text); text-align: left; cursor: pointer;
}
.menu-op:hover:not(:disabled) { background: #eef4ff; }
.menu-op:disabled { opacity: .6; cursor: default; }

.det-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px 18px; }
.det { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.det > span { font-size: 10.5px; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }
.det > b { font-size: 13px; font-weight: 600; word-break: break-word; }
.det.wide { grid-column: 1 / -1; }

@media (max-width: 640px) {
  .hbt { display: none; }
}
</style>