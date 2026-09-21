<script setup>
import { toasts } from '../toast'
</script>

<template>
  <div class="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tipo">
      <span class="tdot" :class="t.tipo"></span>{{ t.msg }}
    </div>
  </div>
</template>

<style scoped>
.toasts { position: fixed; top: 16px; right: 16px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; max-width: 360px; }
.toast { display: flex; align-items: center; gap: 10px; }
.tdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.tdot.ok { background: #fff; }
.tdot.err { background: #fecaca; }
</style>