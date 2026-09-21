import { reactive } from 'vue'

export const confirmBox = reactive({
  open: false,
  titulo: 'Confirmar',
  mensaje: '',
  peligro: false,
  onOk: null
})

export function confirmar(opts = {}, cb) {
  confirmBox.titulo = opts.titulo || 'Confirmar'
  confirmBox.mensaje = opts.mensaje || ''
  confirmBox.peligro = !!opts.peligro
  confirmBox.onOk = cb || null
  confirmBox.open = true
}

export function cancelarConfirm() {
  confirmBox.open = false
  confirmBox.onOk = null
}