<script setup>
import { ref, onMounted } from 'vue'
import { api, formatMoneda } from '../api'

const data = ref(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    data.value = await api.get('/api/dashboard')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h2>Dashboard</h2>
    <p class="muted">Resumen del inventario de activos de la sucursal Camagüey.</p>

    <div v-if="loading" class="center"><span class="spinner"></span></div>
    <p v-else-if="error" class="err">{{ error }}</p>

    <template v-else-if="data">
      <div class="kpis">
        <div class="card kpi"><span class="kpi-v">{{ data.total }}</span><span class="kpi-l">Activos registrados</span></div>
        <div class="card kpi"><span class="kpi-v">${{ formatMoneda(data.valores.valor_usd) }}</span><span class="kpi-l">Valor total (USD)</span></div>
        <div class="card kpi"><span class="kpi-v">{{ data.porEstado.find(e => e.estado === 'ACTIVO')?.cantidad || 0 }}</span><span class="kpi-l">En activo</span></div>
        <div class="card kpi"><span class="kpi-v">{{ data.custodiosTop.length }}</span><span class="kpi-l">Custodios</span></div>
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
            <thead><tr><th>Descripción</th><th>Marca</th><th>Ubicación</th><th>Custodio</th><th>Valor USD</th></tr></thead>
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

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 18px 0 20px; }
.kpi { padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; }
.kpi-v { font-size: 24px; font-weight: 800; }
.kpi-l { color: var(--muted); font-size: 12px; font-weight: 600; }

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