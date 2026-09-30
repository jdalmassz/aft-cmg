<script setup>
// Cajón único de la aplicación: entra por la derecha en escritorio y desde abajo en
// móvil, donde además se cierra arrastrando hacia abajo. Sustituye a los modales.
// La ✕ va en la cabecera; con `sinClose` (la vista previa de la hoja) no tiene.
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  titulo: { type: String, default: '' },
  subtitulo: { type: String, default: '' },
  ancho: { type: Number, default: 440 },
  clase: { type: String, default: '' },
  // Estilos extra en línea, por si un cajón necesita variantes que no se pueden
  // expresar con `ancho`/`clase` (p. ej. la reserva --dw-pegado de la vista previa).
  extra: { type: Object, default: () => ({}) },
  // La vista previa de la hoja no tiene botón ✕: se cierra con el backdrop, con
  // Escape o al cerrar el cajón de opciones (que la lleva consigo).
  sinClose: { type: Boolean, default: false },
  /**
   * Cuántos pisos por encima va este cajón.
   *
   * Todos los cajones compartían `z-index`, así que cuando se abrían dos a la vez
   * mandaba el ORDEN EN EL DOM, no quién se abrió último. El de confirmar se monta en
   * `App.vue`, antes que los de cada vista, y por eso el «¿seguro que lo elimino?»
   * salía DEBAJO del cajón de editar: había que cerrar uno para ver el otro, y el que
   * quedaba encima no era el que te estaba preguntando.
   *
   * `nivel: 1` lo sube por encima de cualquier cajón normal. Va como número y no como
   * clase para que se vea de un vistazo quién está encima de quién.
   */
  nivel: { type: Number, default: 0 }
})

const zBackdrop = () => 850 + props.nivel * 20
const zPanel = () => 860 + props.nivel * 20
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
      <div v-if="open" class="dw-backdrop" :style="{ zIndex: zBackdrop() }" @click="cerrar"></div>
    </transition>
    <transition name="dw">
      <aside
        v-if="open"
        class="dw"
        :class="clase"
        :style="[extra, { '--dw-ancho': ancho + 'px', zIndex: zPanel(), transform: arrastre ? `translateY(${arrastre}px)` : null, transition: arrastre ? 'none' : null }]"
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
          <!-- Decía «Eliminar», en el título y en la etiqueta de accesibilidad. Este botón
               CIERRA; el que elimina es otro y está en el pie. Quien navegue con lector de
               pantalla oía «Eliminar» en cada cajón que abriera. -->
          <button v-if="!sinClose" class="dw-close" title="Cerrar" aria-label="Cerrar" @click="cerrar">×</button>
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
/* La vista previa de la hoja no tiene ✕: la cabecera queda sin botón, pero el
   título y el subtítulo siguen vivos para que se sepa qué se está viendo. */
.dw-head--notitle { justify-content: center; }
.dw-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.dw-foot { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 18px; border-top: 1px solid var(--border); }
.dw-foot .btn { flex: 1; justify-content: center; }

.dw-enter-active, .dw-leave-active { transition: transform 0.22s ease; }
.dw-enter-from, .dw-leave-to { transform: translateX(100%); }
.dw-fade-enter-active, .dw-fade-leave-active { transition: opacity 0.2s; }
.dw-fade-enter-from, .dw-fade-leave-to { opacity: 0; }

/* Tres tamaños de pantalla para la vista previa de la hoja:
   - Pantalla grande (≥1024): cabe al lado del cajón de opciones, se queda pegada
     a su izquierda y ocupa el resto (--dw-pegado = ancho del cajón de opciones).
   - Pantalla mediana (641–1023): no cabe al lado, se abre a todo el ancho
     encima; el cajón de opciones queda detrás y se recupera cerrando la hoja.
   - Móvil (≤640): hoja desde abajo, a pantalla completa. */
@media (min-width: 1024px) {
  .dw.preview-drawer { left: 0; right: var(--dw-pegado, 0px); width: auto; max-width: none; }
  .dw.preview-drawer.dw-enter-from, .dw.preview-drawer.dw-leave-to { transform: translateX(-100%); }
}
@media (min-width: 641px) and (max-width: 1023px) {
  .dw.preview-drawer { left: 0; right: 0; width: auto; max-width: none; }
}

/* El cuerpo de la vista previa no rueda: la hoja llena lo que hay y ya se
   desplaza dentro del propio visor del PDF. */
.preview-drawer .dw-body { display: flex; flex-direction: column; overflow: hidden; padding: 12px; }

@media (max-width: 640px) {
  .dw {
    top: auto; bottom: 0; left: 0; right: 0; width: 100%; height: auto; max-height: 92dvh;
    border-radius: 16px 16px 0 0; box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.25);
  }
  .dw-grip { cursor: grab; }
  .dw-handle { display: block; width: 40px; height: 4px; border-radius: 4px; background: #cbd5e1; margin: 8px auto 0; }
  .dw-head { padding-top: 10px; }
  .dw-enter-from, .dw-leave-to { transform: translateY(100%); }
  /* La hoja es lo que importa: en móvil se lleva toda la pantalla. */
  .dw.preview-drawer { top: 0; bottom: 0; height: auto; max-height: none; border-radius: 0; }
}
</style>
