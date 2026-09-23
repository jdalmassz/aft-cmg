<script setup>
import { confirmBox, cancelarConfirm } from '../confirm'
import Drawer from './Drawer.vue'

function ejecutar() {
  const cb = confirmBox.onOk
  cancelarConfirm()
  if (cb) cb()
}
</script>

<template>
  <Drawer :open="confirmBox.open" :titulo="confirmBox.titulo" :ancho="400" @close="cancelarConfirm">
    <p class="msg">{{ confirmBox.mensaje }}</p>
    <template #pie>
      <button class="btn sec" @click="cancelarConfirm">Cancelar</button>
      <button class="btn" :class="{ danger: confirmBox.peligro }" @click="ejecutar">Confirmar</button>
    </template>
  </Drawer>
</template>

<style scoped>
.msg { margin: 4px 0; line-height: 1.5; }
</style>
