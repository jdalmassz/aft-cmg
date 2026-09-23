<script setup>
// Cajón único de la aplicación: entra por la derecha en escritorio y desde abajo en
// móvil, donde además se cierra arrastrando hacia abajo. Sustituye a los modales.
// La ✕ va en la cabecera y no depende del contenedor: nunca puede desaparecer.
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  titulo: { type: String, default: '' },
  subtitulo: { type: String, default: '' },
  ancho: { type: Number, default: 440 },
  clase: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const arrastre = ref(0)
let inicioY = null

const esMovil = () => window.matchMedia('(max-width: 640px)').matches

function cerrar() { emit('close') }

function onKey(e) { if (e.key === 'Escape' && props.open) cerrar() }

watch(() => props.open, (v) => {
  arrastre.value = 0
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
}, { immediate: true })

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function empezar(e) {
  if (!esMovil() || e.target.closest('button, input, select, textarea, a')) return
  inicioY = e.clientY
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function mover(e) {
  if (inicioY === null) return
  arrastre.value = Math.max(0, e.clientY - inicioY)
}
function soltar() {
  if (inicioY === null) return
  inicioY = null
  if (arrastre.value > 90) cerrar()
  arrastre.value = 0
}
</script>

<template>
  <Teleport to="body">
    <transition name="dw-fade">
      <div v-if="open" class="dw-backdrop" @click="cerrar"></div>
    </transition>
    <transition name="dw">
      <aside
        v-if="open"
        class="dw"
        :class="clase"
        :style="{ '--dw-ancho': ancho + 'px', transform: arrastre ? `translateY(${arrastre}px)` : null, transition: arrastre ? 'none' : null }"
        role="dialog"
        aria-modal="true"
      >
        <div class="dw-grip" @pointerdown="empezar" @pointermove="mover" @pointerup="soltar" @pointercancel="soltar">
          <span class="dw-handle"></span>
          <div class="dw-head">
            <div class="dw-title">
              <slot name="antes-titulo" />
              <div class="dw-title-txt">
                <slot name="titulo">
                  <b>{{ titulo }}</b>
                  <span v-if="subtitulo" class="dw-sub">{{ subtitulo }}</span>
                </slot>
              </div>
            </div>
            <button class="dw-close" title="Cerrar" aria-label="Cerrar" @click="cerrar">×</button>
          </div>
        </div>
        <div class="dw-body"><slot /></div>
        <div v-if="$slots.pie" class="dw-foot"><slot name="pie" /></div>
      </aside>
    </transition>
  </Teleport>
</template>

<style>
.dw-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 850; }
.dw {
  position: fixed; top: 0; right: 0; height: 100vh; height: 100dvh;
  width: var(--dw-ancho, 440px); max-width: 100vw;
  background: #fff; z-index: 860; box-shadow: -12px 0 40px rgba(15, 23, 42, 0.25);
  display: flex; flex-direction: column;
}
.dw-grip { flex-shrink: 0; touch-action: none; }
.dw-handle { display: none; }
.dw-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.dw-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dw-title-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dw-title-txt > b { font-size: 15px; }
.dw-sub { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dw-close {
  flex-shrink: 0; width: 34px; height: 34px; display: grid; place-items: center;
  background: #f1f5f9; border: none; border-radius: 8px; font-size: 22px; line-height: 1;
  cursor: pointer; color: var(--text);
}
.dw-close:hover { background: #e2e8f0; }
.dw-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.dw-foot { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 18px; border-top: 1px solid var(--border); }
.dw-foot .btn { flex: 1; justify-content: center; }

.dw-enter-active, .dw-leave-active { transition: transform 0.22s ease; }
.dw-enter-from, .dw-leave-to { transform: translateX(100%); }
.dw-fade-enter-active, .dw-fade-leave-active { transition: opacity 0.2s; }
.dw-fade-enter-from, .dw-fade-leave-to { opacity: 0; }

@media (max-width: 640px) {
  .dw {
    top: auto; bottom: 0; left: 0; right: 0; width: 100%; height: auto; max-height: 92dvh;
    border-radius: 16px 16px 0 0; box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.25);
  }
  .dw-grip { cursor: grab; }
  .dw-handle { display: block; width: 40px; height: 4px; border-radius: 4px; background: #cbd5e1; margin: 8px auto 0; }
  .dw-head { padding-top: 10px; }
  .dw-enter-from, .dw-leave-to { transform: translateY(100%); }
}
</style>
