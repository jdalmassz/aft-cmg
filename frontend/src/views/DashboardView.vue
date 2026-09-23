<script setup>
import { ref, onMounted } from 'vue'
import { api, formatMoneda } from '../api'
import { ok, err } from '../toast'
import AppIcon from '../components/AppIcon.vue'

const data = ref(null)
const loading = ref(true)
const error = ref('')
const exportando = ref(false)
const exportandoPdf = ref(false)

onMounted(async () => {
  try {
    data.value = await api.get('/api/dashboard')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

async function exportarExcel() {
  exportando.value = true
  try {
    await api.download('/api/activos/export', 'AFT-Camaguey-' + new Date().toISOString().slice(0, 10) + '.xlsx')
    ok('Inventario exportado a Excel')
  } catch (e) { err(e.message) } finally { exportando.value = false }
}

async function exportarPdf() {
  exportandoPdf.value = true
  try {
    await api.download('/api/activos/export/pdf', 'Conteo-fisico-' + new Date().toISOString().slice(0, 10) + '.pdf')
    ok('Hoja de conteo físico exportada a PDF')
  } catch (e) { err(e.message) } finally { exportandoPdf.value = false }
}
</script>

<template>
  <div>
    <h2>Dashboard</h2>
    <p class="muted">Resumen del inventario de activos de la sucursal Camagüey.</p>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error" class="err">{{ error }}</p>

    <template v-else-if="data">
      <div class="acciones">
        <router-link to="/activos" class="btn sec sm"><AppIcon name="box" :size="15" /> Ver inventario</router-link>
        <router-link to="/activos" class="btn sm"><AppIcon name="plus" :size="15" /> Nuevo activo</router-link>
        <button class="btn sec sm" :disabled="exportando" @click="exportarExcel"><AppIcon name="file" :size="15" /> {{ exportando ? 'Exportando…' : 'Exportar Excel' }}</button>
        <button class="btn sec sm" :disabled="exportandoPdf" @click="exportarPdf"><AppIcon name="file" :size="15" /> {{ exportandoPdf ? 'Exportando…' : 'Exportar PDF' }}</button>
      </div>

      <div class="kpis">
        <div class="card kpi">
          <div class="kpi-ico blue"><AppIcon name="box" :size="20" /></div>
          <div><span class="kpi-v">{{ data.total }}</span><span class="kpi-l">Activos registrados</span></div>
        </div>
        <div class="card kpi">
          <div class="kpi-ico green"><AppIcon name="dollar" :size="20" /></div>
          <div><span class="kpi-v">${{ formatMoneda(data.valores.valor_usd) }}</span><span class="kpi-l">Valor total (USD)</span></div>
        </div>
        <div class="card kpi">
          <div class="kpi-ico amber"><AppIcon name="dollar" :size="20" /></div>
          <div><span class="kpi-v">${{ formatMoneda(data.valores.valor_cup) }}</span><span class="kpi-l">Valor total (CUP)</span></div>
        </div>
        <div class="card kpi">
          <div class="kpi-ico purple"><AppIcon name="check-circle" :size="20" /></div>
          <div><span class="kpi-v">{{ data.porEstado.find(e => e.estado === 'ACTIVO')?.cantidad || 0 }}</span><span class="kpi-l">En activo</span></div>
        </div>
      </div>

      <div class="card estados">
        <h3>Distribución por estado</h3>
        <div class="estado-chips">
          <span v-for="e in data.porEstado" :key="e.estado" class="chip" :class="e.estado === 'ACTIVO' ? 'chip-ok' : 'chip-warn'">
            {{ e.estado }} · {{ e.cantidad }}
          </span>
        </div>
      </div>

      <div class="grid2">
        <div class="card pane">
          <h3>Por categoría</h3>
          <div class="bars">
            <div v-for="c in data.porCategoria" :key="c.nombre" class="bar-row">
              <div class="bar-lbl">{{ c.nombre }}</div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: (c.cantidad / Math.max(data.total,1) * 100) + '%' }"></div></div>
              <div class="bar-n">{{ c.cantidad }}</div>
            </div>
          </div>
        </div>

        <div class="card pane">
          <h3>Por ubicación</h3>
          <div class="bars">
            <div v-for="u in data.porUbicacion" :key="u.nombre" class="bar-row">
              <div class="bar-lbl">{{ u.nombre.toLowerCase() }}</div>
              <div class="bar-track"><div class="bar-fill alt" :style="{ width: (u.cantidad / Math.max(data.total,1) * 100) + '%' }"></div></div>
              <div class="bar-n">{{ u.cantidad }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card pane">
        <h3>Últimos agregados</h3>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Descripción</th><th>Marca</th><th>Ubicación</th><th>Responsable</th><th>Valor USD</th></tr></thead>
            <tbody>
              <tr v-for="a in data.recientes" :key="a.id">
                <td>{{ a.descripcion }}</td><td>{{ a.marca || '—' }}</td>
                <td>{{ a.ubicacion || '—' }}</td><td>{{ a.custodio || '—' }}</td>
                <td>${{ formatMoneda(a.valor_usd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
h2 { margin: 0 0 4px; }
.muted { color: var(--muted); margin-top: 0; }
.center { display: grid; place-items: center; padding: 60px; }
.err { color: var(--danger); font-weight: 600; }

.acciones { display: flex; gap: 8px; margin: 16px 0 0; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin: 14px 0 18px; }
.kpi { padding: 16px 18px; display: flex; align-items: center; gap: 14px; }
.kpi-ico { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: #fff; flex: none; }
.kpi-ico.blue { background: var(--primary); }
.kpi-ico.green { background: var(--success); }
.kpi-ico.amber { background: #d97706; }
.kpi-ico.purple { background: #7c3aed; }
.kpi .kpi-v { display: block; font-size: 22px; font-weight: 800; line-height: 1.1; }
.kpi .kpi-l { color: var(--muted); font-size: 12px; font-weight: 600; }

.estados { padding: 16px 20px; margin-bottom: 18px; }
.estados h3 { margin: 0 0 12px; font-size: 14px; }
.estado-chips { display: flex; gap: 10px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; }
.chip-ok { background: #dcfce7; color: #166534; }
.chip-warn { background: #fef9c3; color: #854d0e; }

.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }

.pane { padding: 18px 20px; }
.pane h3 { margin: 0 0 14px; font-size: 14px; }

.bars { display: flex; flex-direction: column; gap: 8px; }
.bar-row { display: grid; grid-template-columns: minmax(130px, 1.2fr) 2.5fr 30px; gap: 10px; align-items: center; font-size: 12px; }
.bar-lbl { color: var(--text); font-weight: 600; }
.bar-track { background: #eef1f6; border-radius: 6px; height: 10px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--primary); border-radius: 6px; }
.bar-fill.alt { background: var(--success); }
.bar-n { text-align: right; font-weight: 700; }
</style>