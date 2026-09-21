<script setup>
import { ref, onMounted, computed } from 'vue'
import QRCode from 'qrcode'
import { api, formatMoneda, getUser } from '../api'

const activos = ref([])
const catalogo = ref({ categorias: [], ubicaciones: [], custodios: [], marcas: [] })
const loading = ref(true)
const errores = ref('')

const q = ref('')
const fCategoria = ref('')
const fUbicacion = ref('')
const fCustodio = ref('')
const fEstado = ref('')

const filtrosAplicados = ref({})
const total = ref(0)

const mostrar = ref(false)
const editando = ref(null)
const formulario = ref({})
const guardando = ref(false)

const exportando = ref(false)
const qrAbierto = ref(false)
const qrImagenes = ref([])
const generandoQr = ref(false)

const movAbierto = ref(false)
const movActivo = ref(null)
const movimientos = ref([])
const cargandoMov = ref(false)

const user = computed(() => getUser())
const esAdmin = computed(() => user.value?.rol === 'admin')

const ESTADOS = ['ACTIVO', 'BAJA']

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
    const res = await api.get('/api/activos?' + params.toString())
    activos.value = res.activos
    total.value = res.total
  } catch (e) { errores.value = e.message } finally { loading.value = false }
}

async function cargarCatalogo() {
  catalogo.value = await api.get('/api/catalogo')
}

function aplicar() {
  filtrosAplicados.value = { q: q.value.trim(), categoria: fCategoria.value, ubicacion: fUbicacion.value, custodio: fCustodio.value, estado: fEstado.value }
  cargar()
}

function limpiar() {
  q.value = ''; fCategoria.value = ''; fUbicacion.value = ''; fCustodio.value = ''; fEstado.value = ''
  filtrosAplicados.value = {}
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
    if (editando.value) await api.put(`/api/activos/${editando.value.id}`, body)
    else await api.post('/api/activos', body)
    mostrar.value = false
    cargar()
  } catch (e) { errores.value = e.message } finally { guardando.value = false }
}

async function eliminar(a) {
  if (!confirm(`¿Eliminar "${a.descripcion}"?`)) return
  try {
    await api.del(`/api/activos/${a.id}`)
    cargar()
  } catch (e) { alert(e.message) }
}

async function exportarExcel() {
  exportando.value = true
  errores.value = ''
  try {
    const qs = filtrosQuery().toString()
    await api.download('/api/activos/export' + (qs ? '?' + qs : ''), 'AFT-Camaguey-' + new Date().toISOString().slice(0, 10) + '.xlsx')
  } catch (e) { errores.value = e.message } finally { exportando.value = false }
}

async function generarEtiquetas() {
  qrAbierto.value = true
  generandoQr.value = true
  qrImagenes.value = []
  try {
    const items = activos.value
    const imgs = await Promise.all(items.map(async (a) => {
      const linea = `AFT ${a.codigo || ('ID ' + a.id)}\n${a.descripcion}\n${a.marca || ''} ${a.modelo || ''}`.trim()
      return { ...a, qr: await QRCode.toDataURL(linea, { margin: 1, width: 320 }) }
    }))
    qrImagenes.value = imgs
  } catch (e) { errores.value = 'No se pudieron generar las etiquetas: ' + e.message }
  finally { generandoQr.value = false }
}

function imprimir() { window.print() }

async function verHistorial(a) {
  movActivo.value = a
  movAbierto.value = true
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
  if (m.tipo === 'CAMBIAR_ESTADO') return 'warn'
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
        <p class="muted">{{ total }} registro(s) — sucursal Camagüey</p>
      </div>
      <span class="btns">
        <button class="btn sec sm" :disabled="exportando" @click="exportarExcel" title="Exportar inventario a Excel">{{ exportando ? 'Exportando…' : '📄 Excel' }}</button>
        <button class="btn sec sm" :disabled="!activos.length" @click="generarEtiquetas" title="Generar etiquetas QR de los activos visibles">🖨 QR</button>
        <button class="btn sm" @click="abrirNuevo">+ Nuevo activo</button>
      </span>
    </div>

    <div class="card filtros">
      <input v-model="q" class="input" placeholder="Buscar por descripción, modelo, código…" @keyup.enter="aplicar" />
      <select v-model="fCategoria" class="select"><option value="">Categoría</option><option v-for="c in catalogo.categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="fUbicacion" class="select"><option value="">Ubicación</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">{{ u.nombre }}</option></select>
      <select v-model="fCustodio" class="select"><option value="">Custodio</option><option v-for="c in catalogo.custodios" :key="c.id" :value="c.id">{{ c.nombre }}</option></select>
      <select v-model="fEstado" class="select"><option value="">Estado</option><option v-for="e in ESTADOS" :key="e" :value="e">{{ e }}</option></select>
      <span class="btns">
        <button class="btn sm" @click="aplicar">Filtrar</button>
        <button class="btn sec sm" @click="limpiar">Limpiar</button>
      </span>
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="errores && !activos.length" class="err">{{ errores }}</p>

    <div v-else class="card table-wrap">
      <table class="tbl">
        <thead>
          <tr><th>Código</th><th>Descripción</th><th>Marca</th><th>Modelo</th><th>Categoría</th><th>Ubicación</th><th>Custodio</th><th>Valor CUP</th><th>Valor USD</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="a in activos" :key="a.id">
            <td>{{ a.codigo || '—' }}</td>
            <td><b>{{ a.descripcion }}</b></td>
            <td>{{ a.marca || '—' }}</td>
            <td>{{ a.modelo || '—' }}</td>
            <td>{{ a.categoria || '—' }}</td>
            <td>{{ a.ubicacion || '—' }}</td>
            <td>{{ a.custodio || '—' }}</td>
            <td>{{ formatMoneda(a.valor_cup) }}</td>
            <td>{{ formatMoneda(a.valor_usd) }}</td>
            <td><span class="badge" :class="a.estado === 'ACTIVO' ? 'ok' : 'warn'">{{ a.estado }}</span></td>
            <td class="acciones">
              <button class="btn sec sm" @click="verHistorial(a)" title="Historial de movimientos">🕐</button>
              <button class="btn sec sm" @click="editar(a)" title="Editar">✎</button>
              <button v-if="esAdmin" class="btn danger sm" @click="eliminar(a)" title="Eliminar">🗑</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="mostrar" class="modal-overlay" @click.self="mostrar = false">
      <div class="modal">
        <div class="modal-head">{{ editando ? 'Editar activo' : 'Nuevo activo' }} <button class="close" @click="mostrar = false">×</button></div>
        <div class="modal-body">
          <p v-if="errores" class="err">{{ errores }}</p>
          <div class="form-grid">
            <div class="field"><label>Código</label><input v-model="formulario.codigo" class="input" placeholder="Opcional" /></div>
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
              <select v-model="formulario.ubicacion_id" class="select"><option value="">—</option><option v-for="u in catalogo.ubicaciones" :key="u.id" :value="u.id">{{ u.nombre }}</option></select>
            </div>
            <div class="field"><label>Custodio</label>
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

    <div v-if="movAbierto" class="modal-overlay" @click.self="movAbierto = false">
      <div class="modal">
        <div class="modal-head">Historial — {{ movActivo?.descripcion || '' }} <button class="close" @click="movAbierto = false">×</button></div>
        <div class="modal-body">
          <p v-if="errores" class="err">{{ errores }}</p>
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
        <div class="modal-foot"><button class="btn sec" @click="movAbierto = false">Cerrar</button></div>
      </div>
    </div>

    <div v-if="qrAbierto" class="modal-overlay" @click.self="qrAbierto = false">
      <div class="modal qr-modal">
        <div class="modal-head">Etiquetas QR <button class="close" @click="qrAbierto = false">×</button></div>
        <div class="modal-body">
          <p v-if="errores" class="err">{{ errores }}</p>
          <p class="muted">{{ qrImagenes.length }} etiqueta(s) para los {{ total }} activos visibles.</p>
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
          <button class="btn" :disabled="!qrImagenes.length" @click="imprimir">🖨 Imprimir</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.head h2 { margin: 0; } .muted { color: var(--muted); margin: 4px 0 0; }
.head .btns { display: flex; gap: 8px; align-items: center; }
.acciones { display: flex; gap: 6px; }
.filtros { display: flex; gap: 10px; padding: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.filtros .input { flex: 1 1 220px; }
.filtros .select { flex: 0 1 200px; }
.filtros .btns { display: flex; gap: 6px; align-items: center; }
.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }
</style>