<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import AppIcon from '../components/AppIcon.vue'
import Drawer from '../components/Drawer.vue'
import { ok, err } from '../toast'
import { confirmar } from '../confirm'

const areas = ref([])
const ubicaciones = ref([])
const loading = ref(true)
const error = ref('')

// Un solo cajón para las cuatro ediciones: tipo 'area' | 'ubicacion'
const cajon = ref(null)
const form = ref({ numero: '', nombre: '', area_id: '' })
const guardando = ref(false)
const errForm = ref('')

const grupos = computed(() => {
  const g = areas.value.map((a) => ({ ...a, ubicaciones: ubicaciones.value.filter((u) => u.area_id === a.id) }))
  const sueltas = ubicaciones.value.filter((u) => !u.area_id)
  if (sueltas.length) g.push({ id: null, etiqueta: 'Sin área asignada', ubicaciones: sueltas })
  return g
})

const totalActivos = (ubs) => ubs.reduce((s, u) => s + u.activos, 0)

async function cargar() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/api/admin/areas')
    areas.value = r.areas
    ubicaciones.value = r.ubicaciones
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

function abrir(tipo, item = null, areaId = '') {
  errForm.value = ''
  const siguiente = Math.max(0, ...areas.value.map((a) => a.numero)) + 1
  form.value = {
    numero: item?.numero ?? (tipo === 'area' ? siguiente : ''),
    nombre: item?.nombre || '',
    area_id: item ? (item.area_id || '') : areaId
  }
  cajon.value = { tipo, item }
}

const tituloCajon = computed(() => {
  if (!cajon.value) return ''
  const { tipo, item } = cajon.value
  if (tipo === 'area') return item ? 'Editar área' : 'Nueva área'
  return item ? 'Editar ubicación' : 'Nueva ubicación'
})

async function guardar() {
  const { tipo, item } = cajon.value
  const nombre = String(form.value.nombre || '').trim()
  if (tipo === 'ubicacion' && !nombre) { errForm.value = 'Escribe el nombre'; return }
  if (tipo === 'area' && !(Number(form.value.numero) >= 1)) { errForm.value = 'Pon el número del área'; return }
  const body = tipo === 'area'
    ? { numero: Number(form.value.numero), nombre }
    : { nombre, area_id: form.value.area_id ? Number(form.value.area_id) : null }
  const base = tipo === 'area' ? '/api/admin/areas' : '/api/admin/ubicaciones'
  guardando.value = true
  errForm.value = ''
  try {
    if (item) await api.put(`${base}/${item.id}`, body)
    else await api.post(base, body)
    ok(tipo === 'area' ? 'Área guardada' : 'Ubicación guardada')
    cajon.value = null
    cargar()
  } catch (e) { errForm.value = e.message } finally { guardando.value = false }
}

function eliminar() {
  const { tipo, item } = cajon.value
  const base = tipo === 'area' ? '/api/admin/areas' : '/api/admin/ubicaciones'
  confirmar({
    titulo: tipo === 'area' ? 'Eliminar área' : 'Eliminar ubicación',
    mensaje: `¿Eliminar "${item.etiqueta || item.nombre}"? Esta acción no se puede deshacer.`,
    peligro: true
  }, async () => {
    try {
      await api.del(`${base}/${item.id}`)
      ok('Eliminado')
      cajon.value = null
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
        <h2>Áreas y ubicaciones</h2>
        <p class="muted">{{ areas.length }} área(s) · {{ ubicaciones.length }} ubicación(es). Un área agrupa varias ubicaciones.</p>
      </div>
      <span class="btns">
        <button class="btn sec" @click="abrir('ubicacion')"><AppIcon name="plus" :size="14" /> Ubicación</button>
        <button class="btn" @click="abrir('area')"><AppIcon name="plus" :size="14" /> Nueva área</button>
      </span>
    </div>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error" class="err">{{ error }}</p>

    <div v-else class="grid">
      <div v-for="g in grupos" :key="g.id ?? 'sin'" class="card area" :class="{ suelta: g.id === null }">
        <div class="area-head">
          <div>
            <b>{{ g.etiqueta }}</b>
            <span class="muted">{{ g.ubicaciones.length }} ubicación(es) · {{ totalActivos(g.ubicaciones) }} activo(s)</span>
          </div>
          <button v-if="g.id" class="btn sec sm" title="Editar área" @click="abrir('area', g)"><AppIcon name="edit" :size="14" /></button>
        </div>
        <ul class="ubics">
          <li v-for="u in g.ubicaciones" :key="u.id" @click="abrir('ubicacion', u)">
            <span><span class="num">#{{ u.id }}</span> {{ u.nombre }}</span>
            <span class="badge" :class="u.activos ? 'ok' : 'warn'">{{ u.activos }}</span>
          </li>
          <li v-if="!g.ubicaciones.length" class="vacio">Sin ubicaciones</li>
        </ul>
        <button v-if="g.id" class="add" @click="abrir('ubicacion', null, g.id)"><AppIcon name="plus" :size="13" /> Añadir ubicación</button>
      </div>
    </div>

    <Drawer :open="!!cajon" :titulo="tituloCajon" @close="cajon = null">
      <template v-if="cajon">
        <p v-if="errForm" class="err">{{ errForm }}</p>
        <div class="form-grid una">
          <div v-if="cajon.tipo === 'area'" class="field">
            <label>Número del área *</label>
            <input v-model="form.numero" type="number" min="1" step="1" class="input" @keyup.enter="guardar" />
          </div>
          <div class="field">
            <label>{{ cajon.tipo === 'area' ? 'Nombre (opcional)' : 'Nombre *' }}</label>
            <input v-model="form.nombre" class="input" :placeholder="cajon.tipo === 'area' ? 'Sale como «Área 2 - NOMBRE»' : ''" @keyup.enter="guardar" />
          </div>
          <div v-if="cajon.tipo === 'ubicacion'" class="field">
            <label>Área</label>
            <select v-model="form.area_id" class="select">
              <option value="">Sin área</option>
              <option v-for="a in areas" :key="a.id" :value="a.id">{{ a.etiqueta }}</option>
            </select>
          </div>
        </div>
        <p v-if="cajon.item && cajon.tipo === 'ubicacion'" class="muted nota">{{ cajon.item.activos }} activo(s) en esta ubicación. Cambiar el área no mueve ni modifica los activos.</p>
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
.area.suelta { border-style: dashed; }
.area-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.area-head b { display: block; font-size: 14px; }
.area-head .muted { font-size: 12px; }
.num {
  display: inline-block; padding: 1px 6px; margin-right: 2px;
  background: #eef4ff; color: var(--primary-dark); border: 1px solid #c9dcff;
  border-radius: 6px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.ubics { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ubics li {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 7px 9px; border-radius: 8px; background: #f8fafc; cursor: pointer; font-size: 13px;
}
.ubics li:hover { background: #eef4ff; }
.ubics li.vacio { cursor: default; color: var(--muted); background: none; font-style: italic; }
.add {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  background: none; border: none; color: var(--primary); font-weight: 600; font-size: 12px; cursor: pointer; padding: 2px 0;
}
</style>
