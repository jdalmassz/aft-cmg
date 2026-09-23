<script setup>
import { ref, onMounted, computed } from 'vue'
import QRCode from 'qrcode'
import { api, formatMoneda, getUser } from '../api'
import AppIcon from '../components/AppIcon.vue'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'

const activos = ref([])
const catalogo = ref({ categorias: [], ubicaciones: [], custodios: [], marcas: [] })
const loading = ref(true)
const errores = ref('')

const q = ref('')
const fCategoria = ref('')
const fUbicacion = ref('')
const fResponsable = ref('')
const fEstado = ref('')

const filtrosAplicados = ref({})
const total = ref(0)
const pagina = ref(1)
const porPagina = ref(50)

const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / porPagina.value)))

const mostrar = ref(false)
const editando = ref(null)
const formulario = ref({})
const guardando = ref(false)

const exportando = ref(false)
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

const nome = (lista, id) => lista.find((x) => x.id === Number(id))?.nombre || ''

const chips = computed(() => {
  const f = filtrosAplicados.value
  const out = []
  if (f.q) out.push({ k: 'q', texto: `«${f.q}»` })
  if (f.categoria) out.push({ k: 'categoria', texto: nome(catalogo.value.categorias, f.categoria) })
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
  filtrosAplicados.value = { q: q.value.trim(), categoria: fCategoria.value, ubicacion: fUbicacion.value, custodio: fResponsable.value, estado: fEstado.value }
  cargar()
}

function limpiar() {
  q.value = ''; fCategoria.value = ''; fUbicacion.value = ''; fResponsable.value = ''; fEstado.value = ''
  filtrosAplicados.value = {}
  if (pagina.value !== 1) pagina.value = 1
  cargar()
}

function quitarChip(k) {
  if (k === 'q') q.value = ''
  if (k === 'categoria') fCategoria.value = ''
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
  editando.value = null
  formulario.value = emptyForm()
  mostrar.value = true
}

function editar(a) {
  editando.value = a
  formulario.value = {
    codigo: a.codigo || '', descripcion: a.descripcion, marca_id: a.marca_id || '',
    modelo: a.modelo || '', valor_cup: a.valor_cup ?? '', valor_usd: a.valor_usd ?? '',
    categoria_id: a.categoria_id || '', sucursal_id: a.sucursal_id || 1,
    fecha_adquisicion: a.fecha_adquisicion || '', ubicacion_id: a.ubicacion_id || '',
    custodio_id: a.custodio_id || '', estado: a.estado || 'ACTIVO', comentarios: a.comentarios || ''
  }
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
    const aid = editando.value ? editando.value.id : activoSel.value?.id
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

async function exportarExcel() {
  exportando.value = true
  errores.value = ''
  try {
    const qs = filtrosQuery().toString()
    await api.download('/api/activos/export' + (qs ? '?' + qs : ''), 'AFT-Camaguey-' + new Date().toISOString().slice(0, 10) + '.xlsx')
    ok('Inventario exportado a Excel')
  } catch (e) { errores.value = e.message } finally { exportando.value = false }
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
      const linea = `AFT ${a.codigo || ('ID ' + a.id)}\n${a.descripcion}\n${a.marca || ''} ${a.modelo || ''}`.trim()
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
        <p class="muted">{{ total }} registro(s) — sucursal Camagüey · <span class="hint">toca una fila para ver todos los detalles</span></p>
      </div>
      <span class="btns">
        <button class="btn sec sm" :class="{ on: filasCompactas }" @click="toggleCompacto" :title="filasCompactas ? 'Filas normales' : 'Filas compactas (ver más registros)'"><AppIcon name="rows" :size="15" /> <span class="hbt">Compacto</span></button>
        <button class="btn sec sm" :disabled="exportando" @click="exportarExcel" title="Exportar inventario a Excel"><AppIcon name="file" :size="15" /> {{ exportando ? 'Exportando…' : 'Excel' }}</button>
        <button class="btn sec sm" :disabled="!total" @click="generarEtiquetas" title="Generar etiquetas QR de los activos filtrados"><AppIcon name="qr" :size="15" /> QR</button>
        <button class="btn sm" @click="abrirNuevo"><AppIcon name="plus" :size="15" /> Nuevo activo</button>
      </span>
    </div>

    <div class="card filtros">
      <input v-model="q" class="input" placeholder="Buscar por descripción, modelo, código…" @keyup.enter="aplicar" />
      <select v-model="fCategoria" class="select" @change="aplicar"><option value="">Categoría</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="fUbicacion" class="select" @change="aplicar"><option value="">Ubicación</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}</option></select>
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
      <p>No hay activos{{ total ? ' con los filtros aplicados' : ' registrados todavía' }}.</p>
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

    <div v-if="drawerAbierto" class="drawer-backdrop" @click.stop="cerrarDrawer"></div>
    <transition name="drawer">
      <aside v-if="drawerAbierto" class="drawer">
        <div class="drawer-head">
          <div class="drawer-title">
            <button v-if="histDrawer" class="back" title="Volver al detalle" @click="histDrawer = false"><AppIcon name="arrow-left" :size="16" /></button>
            <div class="drawer-title-txt">
              <template v-if="histDrawer">
                <b>Historial</b>
                <span class="muted">{{ activoSel.codigo || 'ID ' + activoSel.id }} — {{ activoSel.descripcion }}</span>
              </template>
              <template v-else-if="editDrawer">
                <b>Editar activo</b>
                <span class="muted">{{ activoSel.codigo || 'ID ' + activoSel.id }}</span>
              </template>
              <template v-else>
                <b class="codigo">{{ activoSel.codigo || 'ID ' + activoSel.id }}</b>
                <span class="muted">{{ activoSel.descripcion }}</span>
              </template>
            </div>
          </div>
          <button class="close" @click="cerrarDrawer">×</button>
        </div>
        <div class="drawer-body" :class="{ 'drawer-form': editDrawer }">
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
            <div class="form-grid">
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
                <select v-model="formulario.ubicacion_id" class="select"><option value="">—</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}</option></select>
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
              <div class="det"><span>Ubicación</span><b><span v-if="activoSel.ubicacion_id" class="ubicacion-id">#{{ activoSel.ubicacion_id }}</span> {{ activoSel.ubicacion || '—' }}</b></div>
              <div class="det"><span>Responsable</span><b>{{ activoSel.custodio || '—' }}</b></div>
              <div class="det"><span>Valor CUP</span><b>{{ formatMoneda(activoSel.valor_cup) }}</b></div>
              <div class="det"><span>Valor USD</span><b>{{ formatMoneda(activoSel.valor_usd) }}</b></div>
              <div class="det"><span>Fecha de adquisición</span><b>{{ activoSel.fecha_adquisicion || '—' }}</b></div>
              <div class="det"><span>Creado</span><b>{{ fmtFecha(activoSel.created_at) }}</b></div>
              <div class="det wide"><span>Comentarios</span><b>{{ activoSel.comentarios || '—' }}</b></div>
            </div>
          </template>
        </div>
        <div class="drawer-foot">
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
        </div>
      </aside>
    </transition>

    <div v-if="mostrar" class="modal-overlay" @click.self="mostrar = false">
      <div class="modal">
        <div class="modal-head">{{ editando ? 'Editar activo' : 'Nuevo activo' }} <button class="close" @click="mostrar = false">×</button></div>
        <div class="modal-body">
          <p v-if="errores" class="err">{{ errores }}</p>
          <div class="form-grid">
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
              <select v-model="formulario.ubicacion_id" class="select"><option value="">—</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">#{{ u.id }} · {{ u.nombre }}</option></select>
            </div>
            <div class="field"><label>Responsable</label>
              <select v-model="formulario.custodio_id" class="select"><option value="">—</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
            </div>
            <div class="field"><label>Fecha de adquisición</label><input v-model="formulario.fecha_adquisicion" class="input" placeholder="dd-mm-año" /></div>
            <div class="field"><label>Valor CUP</label><input v-model="formulario.valor_cup" type="number" step="0.01" class="input" /></div>
            <div class="field"><label>Valor USD</label><input v-model="formulario.valor_usd" type="number" step="0.01" class="input" /></div>
            <div class="field full"><label>Comentarios</label><textarea v-model="formulario.comentarios" class="textarea" rows="2"></textarea></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn sec" @click="mostrar = false">Cancelar</button>
          <button class="btn" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </div>
    </div>

    <div v-if="qrAbierto" class="modal-overlay" @click.self="qrAbierto = false">
      <div class="modal qr-modal">
        <div class="modal-head">Etiquetas QR <button class="close" @click="qrAbierto = false">×</button></div>
        <div class="modal-body">
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
        </div>
        <div class="modal-foot">
          <button class="btn sec" @click="qrAbierto = false">Cerrar</button>
          <button class="btn" :disabled="!qrImagenes.length" @click="imprimir"><AppIcon name="printer" :size="15" /> Imprimir</button>
        </div>
      </div>
    </div>
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

.drawer-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 850; }
.drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: 400px; max-width: 100vw;
  background: #fff; z-index: 860; box-shadow: -12px 0 40px rgba(15,23,42,0.25);
  display: flex; flex-direction: column;
}
.drawer-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.drawer-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.drawer-title-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.drawer-title .codigo { font-size: 15px; }
.drawer-title .muted { font-size: 13px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.back { background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px; border-radius: 6px; display: flex; flex-shrink: 0; }
.back:hover { color: var(--primary); background: #eef4ff; }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.drawer-body.drawer-form .form-grid { grid-template-columns: 1fr; }
.drawer-body.drawer-form .field.full { grid-column: auto; }
.drawer-foot { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 18px; border-top: 1px solid var(--border); }
.drawer-foot .btn { flex: 1; justify-content: center; }

@keyframes drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.22s ease, opacity 0.22s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); opacity: 0; }
.drawer-enter-to, .drawer-leave-from { transform: translateX(0); opacity: 1; }

.det-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px 18px; }
.det { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.det > span { font-size: 10.5px; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }
.det > b { font-size: 13px; font-weight: 600; word-break: break-word; }
.det.wide { grid-column: 1 / -1; }

@media (max-width: 640px) {
  .hbt { display: none; }
  .drawer { width: 100%; }
}
</style>