<script setup>
/**
 * ÚTILES Y HERRAMIENTAS — lo que tiene cada responsable.
 *
 * Un activo fijo está en un sitio: su área, su ubicación, y alguien responde por él.
 * Un útil va CON la persona —se lo lleva a su casa si hace falta— y por eso aquí no hay
 * área ni ubicación: la pregunta es siempre «¿quién lo tiene?».
 *
 * Es la misma pantalla que el inventario menos las dos columnas que no existen y más
 * una, la cantidad: de un martillo hay uno, de los destornilladores hay diez y contarlos
 * de uno en uno sería inventarles diez códigos.
 */
import { ref, onMounted, computed } from 'vue'
import { api, formatMoneda, getUser } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { usePreviewPdf } from '../previewPdf'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'

const utiles = ref([])
const catalogo = ref({ categorias: [], custodios: [], marcas: [] })
const loading = ref(true)
const errores = ref('')

const q = ref('')
const fCategoria = ref('')
const fResponsable = ref('')
const fEstado = ref('')

const filtrosAplicados = ref({})
const total = ref(0)
const pagina = ref(1)
const porPagina = ref(50)
const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / porPagina.value)))

const mostrar = ref(false)
const formulario = ref({})
const guardando = ref(false)

const exportando = ref(false)
const exportAbierto = ref(false)
const exportar_ = ref({ formato: 'pdf', responsable: '', separar: '1', numero: '', periodo: '' })

const drawerAbierto = ref(false)
const utilSel = ref(null)
const editDrawer = ref(false)
const histDrawer = ref(false)
const movimientos = ref([])
const cargandoMov = ref(false)

const user = computed(() => getUser())
const esAdmin = computed(() => user.value?.rol === 'admin')

const ESTADOS = ['ACTIVO', 'BAJA']

const nome = (lista, id) => lista.find((x) => x.id === Number(id))?.nombre || ''

const chips = computed(() => {
  const f = filtrosAplicados.value
  const out = []
  if (f.q) out.push({ k: 'q', texto: `«${f.q}»` })
  if (f.categoria) out.push({ k: 'categoria', texto: nome(catalogo.value.categorias, f.categoria) })
  if (f.custodio) out.push({ k: 'custodio', texto: nome(catalogo.value.custodios, f.custodio) })
  if (f.estado) out.push({ k: 'estado', texto: f.estado })
  return out
})

function emptyForm() {
  return {
    codigo: '', descripcion: '', marca_id: '', modelo: '', cantidad: 1,
    valor_cup: '', valor_usd: '', categoria_id: '', sucursal_id: 1,
    fecha_adquisicion: '', custodio_id: '', estado: 'ACTIVO', comentarios: ''
  }
}

function filtrosQuery() {
  const f = filtrosAplicados.value
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.categoria) params.set('categoria', f.categoria)
  if (f.custodio) params.set('custodio', f.custodio)
  if (f.estado) params.set('estado', f.estado)
  return params
}

async function cargar() {
  loading.value = true
  errores.value = ''
  try {
    const params = filtrosQuery()
    params.set('limite', String(porPagina.value))
    params.set('offset', String((pagina.value - 1) * porPagina.value))
    const res = await api.get('/api/utiles?' + params.toString())
    utiles.value = res.activos
    total.value = res.total
    if (total.value && pagina.value > totalPaginas.value) pagina.value = totalPaginas.value
  } catch (e) { errores.value = e.message } finally { loading.value = false }
}

async function cargarCatalogo() {
  catalogo.value = await api.get('/api/catalogo')
}

function aplicar() {
  pagina.value = 1
  filtrosAplicados.value = { q: q.value.trim(), categoria: fCategoria.value, custodio: fResponsable.value, estado: fEstado.value }
  cargar()
}

function limpiar() {
  q.value = ''; fCategoria.value = ''; fResponsable.value = ''; fEstado.value = ''
  filtrosAplicados.value = {}
  if (pagina.value !== 1) pagina.value = 1
  cargar()
}

function quitarChip(k) {
  if (k === 'q') q.value = ''
  if (k === 'categoria') fCategoria.value = ''
  if (k === 'custodio') fResponsable.value = ''
  if (k === 'estado') fEstado.value = ''
  aplicar()
}

function irPagina(p) {
  if (p < 1 || p > totalPaginas.value) return
  pagina.value = p
  cargar()
}

function abrirUtil(u) {
  utilSel.value = u
  editDrawer.value = false
  histDrawer.value = false
  drawerAbierto.value = true
}

function cerrarDrawer() {
  drawerAbierto.value = false
  editDrawer.value = false
  histDrawer.value = false
  utilSel.value = null
}

function abrirNuevo() {
  errores.value = ''
  formulario.value = emptyForm()
  mostrar.value = true
}

function editarDrawer() {
  const u = utilSel.value
  if (!u) return
  errores.value = ''
  formulario.value = {
    codigo: u.codigo || '', descripcion: u.descripcion, marca_id: u.marca_id || '',
    modelo: u.modelo || '', cantidad: u.cantidad ?? 1,
    valor_cup: u.valor_cup ?? '', valor_usd: u.valor_usd ?? '',
    categoria_id: u.categoria_id || '', sucursal_id: u.sucursal_id || 1,
    fecha_adquisicion: u.fecha_adquisicion || '', custodio_id: u.custodio_id || '',
    estado: u.estado || 'ACTIVO', comentarios: u.comentarios || ''
  }
  editDrawer.value = true
}

async function guardar() {
  guardando.value = true
  errores.value = ''
  try {
    const body = { ...formulario.value }
    for (const k of ['marca_id', 'categoria_id', 'sucursal_id', 'custodio_id']) {
      body[k] = body[k] ? Number(body[k]) : null
    }
    for (const k of ['valor_cup', 'valor_usd']) {
      body[k] = body[k] === '' ? null : Number(body[k])
    }
    body.cantidad = Number(body.cantidad) > 0 ? Math.trunc(Number(body.cantidad)) : 1
    if (!body.fecha_adquisicion) body.fecha_adquisicion = null
    const id = mostrar.value ? null : utilSel.value?.id
    if (id) {
      await api.put(`/api/utiles/${id}`, body)
      ok('Útil actualizado')
    } else {
      await api.post('/api/utiles', body)
      ok('Útil registrado')
    }
    mostrar.value = false
    cerrarDrawer()
    cargar()
  } catch (e) { errores.value = e.message } finally { guardando.value = false }
}

function eliminar(u) {
  confirmar({
    titulo: 'Eliminar útil',
    mensaje: `¿Eliminar definitivamente "${u.codigo || u.descripcion}" — ${u.descripcion}? Esta acción no se puede deshacer.`,
    peligro: true
  }, async () => {
    try {
      await api.del(`/api/utiles/${u.id}`)
      ok('Útil eliminado')
      cerrarDrawer()
      cargar()
    } catch (e) { err(e.message) }
  })
}

async function verHistorial() {
  if (!utilSel.value) return
  histDrawer.value = true
  cargandoMov.value = true
  try {
    movimientos.value = (await api.get(`/api/utiles/${utilSel.value.id}/movimientos`)).movimientos || []
  } catch (e) { errores.value = e.message } finally { cargandoMov.value = false }
}

const flecha = (a, b) => `${a || '—'} → ${b || '—'}`

function textoMov(m) {
  switch (m.tipo) {
    case 'CREADO': return 'Registrado' + (m.custodio_destino ? ` a nombre de ${m.custodio_destino}` : '')
    case 'CAMBIO_CUSTODIO': return 'Cambio de responsable: ' + flecha(m.custodio_origen, m.custodio_destino)
    case 'CAMBIAR_ESTADO': return 'Estado: ' + flecha(m.estado_origen, m.estado_destino)
    case 'TRASLADO_UBICACION': return 'Traslado: ' + flecha(m.ubicacion_origen, m.ubicacion_destino)
    default: return m.tipo
  }
}

function fmtFecha(iso) {
  return new Date(iso).toLocaleString('es-CU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function abrirExport(formato) {
  exportar_.value = { ...exportar_.value, formato, responsable: filtrosAplicados.value.custodio || '' }
  exportAbierto.value = true
}

// Los parámetros y el nombre del fichero salen de aquí, para que la vista previa
// y la descarga sean exactamente el mismo documento.
function paramsExport() {
  const c = exportar_.value
  const params = new URLSearchParams()
  if (c.responsable) params.set('custodio', c.responsable)
  // El único corte que tiene sentido aquí es el responsable: un útil no está en
  // ninguna parte, está con alguien.
  if (c.separar) params.set('separar', 'responsable')
  if (c.formato === 'pdf' && c.numero) params.set('conteo', c.numero)
  if (c.formato === 'pdf' && c.periodo.trim()) params.set('periodo', c.periodo.trim())
  return params
}

function nombreExport() {
  const c = exportar_.value
  const quien = c.responsable ? '-' + nome(catalogo.value.custodios, c.responsable).replace(/\s+/g, '_') : ''
  return 'Utiles-y-herramientas' + quien + '-' + new Date().toISOString().slice(0, 10) + (c.formato === 'pdf' ? '.pdf' : '.xlsx')
}

async function descargar() {
  exportando.value = true
  try {
    const pdf = exportar_.value.formato === 'pdf'
    const qs = paramsExport().toString()
    await api.download('/api/utiles/export' + (pdf ? '/pdf' : '') + (qs ? '?' + qs : ''), nombreExport())
    exportAbierto.value = false
  } catch (e) { err(e.message) } finally { exportando.value = false }
}

// Vista previa: el MISMO PDF que se descargaría. Si sale bien, se cierra el
// diálogo de opciones y se abre la hoja encima.
const preview = usePreviewPdf()

async function previsualizar() {
  const qs = paramsExport().toString()
  await preview.abrir('/api/utiles/export/pdf' + (qs ? '?' + qs : ''))
  if (preview.abierta) exportAbierto.value = false
}

onMounted(() => { cargarCatalogo().then(cargar).catch(() => {}) })
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h2>Útiles y herramientas</h2>
        <p class="muted">{{ total }} registro(s) — lo que tiene cada responsable · <span class="hint">toca una fila para ver el detalle</span></p>
      </div>
      <span class="btns">
        <button class="btn sec sm" @click="abrirExport('excel')" title="Listado en Excel, por responsable"><AppIcon name="file" :size="15" /> Excel</button>
        <button class="btn sec sm" :disabled="!total" @click="abrirExport('pdf')" title="Hoja de conteo en PDF, por responsable"><AppIcon name="file" :size="15" /> PDF</button>
        <button class="btn sm" @click="abrirNuevo"><AppIcon name="plus" :size="15" /> Nuevo útil</button>
      </span>
    </div>

    <div class="card filtros">
      <input v-model="q" class="input" placeholder="Buscar por descripción, modelo, código…" @keyup.enter="aplicar" />
      <select v-model="fCategoria" class="select" @change="aplicar"><option value="">Categoría</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
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
    <p v-else-if="errores && !drawerAbierto && !mostrar" class="err">{{ errores }}</p>

    <div v-else-if="!utiles.length" class="card vacio">
      <AppIcon name="box" :size="44" />
      <p>No hay útiles{{ total ? ' con los filtros aplicados' : ' registrados todavía' }}.</p>
      <button v-if="total" class="btn sec sm" @click="limpiar">Limpiar filtros</button>
      <button v-else class="btn sm" @click="abrirNuevo"><AppIcon name="plus" :size="15" /> Registrar el primero</button>
    </div>

    <template v-else>
      <div class="card table-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Código</th><th>Descripción</th><th>Marca</th><th class="num">Cant.</th><th>Responsable</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in utiles" :key="u.id" :class="{ 'fila-act': utilSel?.id === u.id }" @click="abrirUtil(u)">
              <td><b class="codigo">{{ u.codigo || '—' }}</b></td>
              <td><b>{{ u.descripcion }}</b></td>
              <td>{{ u.marca || '—' }}</td>
              <td class="num">{{ u.cantidad }}</td>
              <td><span :class="{ sinresp: !u.custodio }">{{ u.custodio || 'Sin responsable' }}</span></td>
              <td><span class="badge" :class="u.estado === 'ACTIVO' ? 'ok' : 'warn'">{{ u.estado }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="paginacion">
        <label class="pag-lbl">Por página</label>
        <select v-model="porPagina" class="select pag-size" @change="pagina = 1; cargar()">
          <option :value="25">25</option><option :value="50">50</option>
          <option :value="100">100</option><option :value="200">200</option>
        </select>
        <span class="pg-info">Página {{ pagina }} de {{ totalPaginas }} · {{ total }} registros</span>
        <span class="pg-btns">
          <button class="btn sec sm" :disabled="pagina <= 1" @click="irPagina(pagina - 1)">‹ Anterior</button>
          <button class="btn sec sm" :disabled="pagina >= totalPaginas" @click="irPagina(pagina + 1)">Siguiente ›</button>
        </span>
      </div>
    </template>

    <!-- Detalle / editar / historial -->
    <Drawer :open="drawerAbierto" :ancho="420" @close="cerrarDrawer">
      <template #antes-titulo>
        <button v-if="histDrawer || editDrawer" class="back" title="Volver al detalle" @click="histDrawer = false; editDrawer = false"><AppIcon name="arrow-left" :size="16" /></button>
      </template>
      <template #titulo>
        <template v-if="utilSel && histDrawer"><b>Historial</b><span class="dw-sub">{{ utilSel.descripcion }}</span></template>
        <template v-else-if="utilSel && editDrawer"><b>Editar útil</b><span class="dw-sub">{{ utilSel.codigo || 'ID ' + utilSel.id }}</span></template>
        <template v-else-if="utilSel"><b class="codigo">{{ utilSel.codigo || 'ID ' + utilSel.id }}</b><span class="dw-sub">{{ utilSel.descripcion }}</span></template>
      </template>

      <template v-if="utilSel">
        <p v-if="errores" class="err">{{ errores }}</p>

        <div v-if="histDrawer">
          <div v-if="cargandoMov" class="center"><span class="spinner"></span></div>
          <p v-else-if="!movimientos.length" class="muted">Sin movimientos registrados.</p>
          <ul v-else class="hist">
            <li v-for="m in movimientos" :key="m.id">
              <b>{{ textoMov(m) }}</b>
              <span class="muted">{{ fmtFecha(m.created_at) }}{{ m.usuario ? ' · ' + m.usuario : '' }}</span>
            </li>
          </ul>
        </div>

        <div v-else-if="editDrawer" class="form">
          <div class="field"><label>Descripción *</label><input v-model="formulario.descripcion" class="input" /></div>
          <div class="dos">
            <div class="field"><label>Código</label><input v-model="formulario.codigo" class="input" placeholder="Se pone solo (0001)" /></div>
            <div class="field"><label>Cantidad</label><input v-model="formulario.cantidad" class="input" type="number" min="1" /></div>
          </div>
          <div class="dos">
            <div class="field"><label>Marca</label><select v-model="formulario.marca_id" class="select"><option value="">—</option><option v-for="m in catalogo.marcas" :key="m.id" :value="m.id">{{ m.nombre }}</option></select></div>
            <div class="field"><label>Modelo</label><input v-model="formulario.modelo" class="input" /></div>
          </div>
          <div class="field"><label>Responsable</label><select v-model="formulario.custodio_id" class="select"><option value="">Sin responsable</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></div>
          <div class="field"><label>Categoría</label><select v-model="formulario.categoria_id" class="select"><option value="">—</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></div>
          <div class="dos">
            <div class="field"><label>Valor CUP</label><input v-model="formulario.valor_cup" class="input" type="number" step="0.01" /></div>
            <div class="field"><label>Valor USD</label><input v-model="formulario.valor_usd" class="input" type="number" step="0.01" /></div>
          </div>
          <div class="dos">
            <div class="field"><label>Fecha de adquisición</label><input v-model="formulario.fecha_adquisicion" class="input" placeholder="dd-mmm-aa" /></div>
            <div class="field"><label>Estado</label><select v-model="formulario.estado" class="select"><option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option></select></div>
          </div>
          <div class="field"><label>Comentarios</label><textarea v-model="formulario.comentarios" class="input" rows="3"></textarea></div>
        </div>

        <div v-else class="det-grid">
          <div class="det"><span>Responsable</span><b>{{ utilSel.custodio || 'Sin responsable' }}</b></div>
          <div class="det"><span>Cantidad</span><b>{{ utilSel.cantidad }}</b></div>
          <div class="det"><span>Marca</span><b>{{ utilSel.marca || '—' }}</b></div>
          <div class="det"><span>Modelo</span><b>{{ utilSel.modelo || '—' }}</b></div>
          <div class="det"><span>Categoría</span><b>{{ utilSel.categoria || '—' }}</b></div>
          <div class="det"><span>Estado</span><b>{{ utilSel.estado }}</b></div>
          <div class="det"><span>Valor CUP</span><b>{{ utilSel.valor_cup == null ? '—' : formatMoneda(utilSel.valor_cup) }}</b></div>
          <div class="det"><span>Valor USD</span><b>{{ utilSel.valor_usd == null ? '—' : formatMoneda(utilSel.valor_usd) }}</b></div>
          <div class="det"><span>Adquisición</span><b>{{ utilSel.fecha_adquisicion || '—' }}</b></div>
          <div class="det wide" v-if="utilSel.comentarios"><span>Comentarios</span><b>{{ utilSel.comentarios }}</b></div>
        </div>
      </template>

      <template #pie>
        <template v-if="editDrawer">
          <button class="btn sec" @click="editDrawer = false">Cancelar</button>
          <button class="btn" :disabled="guardando || !formulario.descripcion" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        </template>
        <template v-else-if="!histDrawer && utilSel">
          <button class="btn sec" @click="verHistorial"><AppIcon name="clock" :size="15" /> Historial</button>
          <button v-if="esAdmin" class="btn danger" @click="eliminar(utilSel)"><AppIcon name="trash" :size="15" /> Eliminar</button>
          <button class="btn" @click="editarDrawer"><AppIcon name="edit" :size="15" /> Editar</button>
        </template>
      </template>
    </Drawer>

    <!-- Alta -->
    <Drawer :open="mostrar" titulo="Nuevo útil o herramienta" :ancho="420" @close="mostrar = false">
      <p v-if="errores" class="err">{{ errores }}</p>
      <div class="form">
        <div class="field"><label>Descripción *</label><input v-model="formulario.descripcion" class="input" placeholder="Juego de destornilladores" /></div>
        <div class="dos">
          <div class="field"><label>Código</label><input v-model="formulario.codigo" class="input" placeholder="Se pone solo (0001)" /></div>
          <div class="field"><label>Cantidad</label><input v-model="formulario.cantidad" class="input" type="number" min="1" /></div>
        </div>
        <div class="dos">
          <div class="field"><label>Marca</label><select v-model="formulario.marca_id" class="select"><option value="">—</option><option v-for="m in catalogo.marcas" :key="m.id" :value="m.id">{{ m.nombre }}</option></select></div>
          <div class="field"><label>Modelo</label><input v-model="formulario.modelo" class="input" /></div>
        </div>
        <div class="field"><label>Responsable</label><select v-model="formulario.custodio_id" class="select"><option value="">Sin responsable</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></div>
        <div class="field"><label>Categoría</label><select v-model="formulario.categoria_id" class="select"><option value="">—</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select></div>
        <div class="dos">
          <div class="field"><label>Valor CUP</label><input v-model="formulario.valor_cup" class="input" type="number" step="0.01" /></div>
          <div class="field"><label>Valor USD</label><input v-model="formulario.valor_usd" class="input" type="number" step="0.01" /></div>
        </div>
        <div class="dos">
          <div class="field"><label>Fecha de adquisición</label><input v-model="formulario.fecha_adquisicion" class="input" placeholder="dd-mmm-aa" /></div>
          <div class="field"><label>Estado</label><select v-model="formulario.estado" class="select"><option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option></select></div>
        </div>
        <div class="field"><label>Comentarios</label><textarea v-model="formulario.comentarios" class="input" rows="3"></textarea></div>
      </div>
      <p class="muted nota">Un útil no lleva ubicación: va con su responsable.</p>
      <template #pie>
        <button class="btn sec" @click="mostrar = false">Cancelar</button>
        <button class="btn" :disabled="guardando || !formulario.descripcion" @click="guardar">{{ guardando ? 'Guardando…' : 'Registrar' }}</button>
      </template>
    </Drawer>

    <!-- Exportar -->
    <Drawer :open="exportAbierto" :titulo="exportar_.formato === 'pdf' ? 'Hoja de conteo (PDF)' : 'Listado (Excel)'" :ancho="380" @close="exportAbierto = false">
      <div class="form">
        <div class="field"><label>Responsable</label>
          <select v-model="exportar_.responsable" class="select"><option value="">Todos los responsables</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
        </div>
        <div class="field"><label>Separar</label>
          <select v-model="exportar_.separar" class="select">
            <option value="">Todo junto</option>
            <option value="1">Cada responsable por separado</option>
          </select>
          <small v-if="exportar_.separar" class="muted">{{ exportar_.formato === 'pdf' ? 'Sus propias páginas, con su firma,' : 'Una hoja del libro' }} por responsable.</small>
        </div>
        <template v-if="exportar_.formato === 'pdf'">
          <div class="field"><label>No. de conteo</label><input v-model="exportar_.numero" class="input" inputmode="numeric" placeholder="Opcional" /></div>
          <div class="field"><label>Período</label><input v-model="exportar_.periodo" class="input" placeholder="En blanco = mes actual" /></div>
        </template>
      </div>
      <p class="muted nota">{{ exportar_.formato === 'pdf' ? 'Salen sólo los que están en estado ACTIVO, agrupados por responsable.' : 'Mismas columnas que el inventario, sin ubicación y con la cantidad.' }}</p>
      <template #pie>
        <button class="btn sec" @click="exportAbierto = false">Cancelar</button>
        <button v-if="exportar_.formato === 'pdf'" class="btn sec" :disabled="preview.cargando || !total" title="Ver la hoja antes de descargarla" @click="previsualizar">
          <AppIcon name="eye" :size="15" /> {{ preview.cargando ? 'Generando…' : 'Vista previa' }}
        </button>
        <button class="btn" :disabled="exportando" @click="descargar"><AppIcon name="file" :size="15" /> {{ exportando ? 'Generando…' : 'Descargar' }}</button>
      </template>
    </Drawer>

    <Drawer :open="preview.abierta" titulo="Vista previa de la hoja" subtitulo="Tal como se imprimirá" :ancho="860" clase="preview-drawer" @close="preview.cerrar">
      <div class="preview-caja">
        <iframe v-if="preview.url" class="preview-iframe" :src="preview.url" title="Vista previa de la hoja de conteo"></iframe>
        <div v-else class="center"><span class="spinner"></span></div>
      </div>
      <template #pie>
        <button class="btn sec" @click="preview.cerrar">Cerrar</button>
        <button class="btn sec" :disabled="!preview.url" @click="preview.descargar(nombreExport())"><AppIcon name="file" :size="15" /> Descargar</button>
        <button class="btn" :disabled="!preview.url" @click="preview.imprimir"><AppIcon name="printer" :size="15" /> Imprimir</button>
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
.sinresp { color: var(--muted); font-style: italic; }

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
table.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }

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

.form { display: flex; flex-direction: column; gap: 12px; }
.dos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.det-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px 18px; }
.det { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.det > span { font-size: 10.5px; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }
.det > b { font-size: 13px; font-weight: 600; word-break: break-word; }
.det.wide { grid-column: 1 / -1; }

.hist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.hist li { display: flex; flex-direction: column; gap: 2px; border-left: 2px solid #c9dcff; padding-left: 10px; }
.hist .muted { font-size: 11.5px; margin: 0; }
</style>
