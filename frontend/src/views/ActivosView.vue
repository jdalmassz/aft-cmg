<script setup>
import { ref, onMounted, computed } from 'vue'
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

async function cargar() {
  loading.value = true
  errores.value = ''
  try {
    const params = new URLSearchParams()
    if (filtrosAplicados.value.q) params.set('q', filtrosAplicados.value.q)
    if (filtrosAplicados.value.categoria) params.set('categoria', filtrosAplicados.value.categoria)
    if (filtrosAplicados.value.ubicacion) params.set('ubicacion', filtrosAplicados.value.ubicacion)
    if (filtrosAplicados.value.custodio) params.set('custodio', filtrosAplicados.value.custodio)
    if (filtrosAplicados.value.estado) params.set('estado', filtrosAplicados.value.estado)
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

function id2name(lista, id) { return lista.find((x) => x.id === Number(id))?.nombre || '—' }

onMounted(() => { cargarCatalogo().then(cargar).catch(() => {}) })
</script>

<template>
  <div>
    <div class="head">
      <div>
        <h2>Inventario de Activos</h2>
        <p class="muted">{{ total }} registro(s) — sucursal Camagüey</p>
      </div>
      <button class="btn" @click="abrirNuevo">+ Nuevo activo</button>
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
            <td>
              <button class="btn sec sm" @click="editar(a)">✎</button>
              <button v-if="esAdmin" class="btn danger sm" @click="eliminar(a)">🗑</button>
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
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.head h2 { margin: 0; } .muted { color: var(--muted); margin: 4px 0 0; }
.filtros { display: flex; gap: 10px; padding: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.filtros .input { flex: 1 1 220px; }
.filtros .select { flex: 0 1 200px; }
.filtros .btns { display: flex; gap: 6px; align-items: center; }
.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }
</style>