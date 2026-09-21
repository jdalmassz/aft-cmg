<script setup>
import { confirmBox, cancelarConfirm } from '../confirm'

function ejecutar() {
  const cb = confirmBox.onOk
  cancelarConfirm()
  if (cb) cb()
}
</script>

<template>
  <div v-if="confirmBox.open" class="modal-overlay" @click.self="cancelarConfirm">
    <div class="modal confirm">
      <div class="modal-head">{{ confirmBox.titulo }} <button class="close" @click="cancelarConfirm">×</button></div>
      <div class="modal-body"><p class="msg">{{ confirmBox.mensaje }}</p></div>
      <div class="modal-foot">
        <button class="btn sec" @click="cancelarConfirm">Cancelar</button>
        <button class="btn" :class="{ danger: confirmBox.peligro }" @click="ejecutar">Confirmar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm { max-width: 420px; }
.msg { margin: 4px 0; line-height: 1.5; }
</style>