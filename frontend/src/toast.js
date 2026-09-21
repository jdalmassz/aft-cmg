import { reactive } from 'vue'

export const toasts = reactive([])
let uid = 0

export function pushToast(tipo, msg) {
  const t = { id: ++uid, tipo, msg }
  toasts.push(t)
  setTimeout(() => {
    const i = toasts.findIndex((x) => x.id === t.id)
    if (i >= 0) toasts.splice(i, 1)
  }, 4200)
}

export const ok = (m) => pushToast('ok', m)
export const err = (m) => pushToast('err', m)