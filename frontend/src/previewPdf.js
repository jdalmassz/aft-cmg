import { reactive, watch } from 'vue'
import { getToken } from './api'
import { err } from './toast'

// Vista previa de un PDF que genera el servidor: se pide con las mismas
// credenciales que la descarga y se guarda como blob, para meterlo en el iframe
// del visor sin que éste tenga que autenticarse ni volver a llamar a la API.
// Se devuelve un objeto reactivo para que en la plantilla se lea directamente
// (`preview.abierta`) sin andar con `.value`.
export function usePreviewPdf() {
  const preview = reactive({
    abierta: false,
    url: '',
    cargando: false,

    async abrir(ruta) {
      preview.cargando = true
      try {
        const headers = {}
        const token = getToken()
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await fetch(ruta, { headers })
        if (!res.ok) throw new Error('No se pudo generar la vista previa')
        const blob = await res.blob()
        if (preview.url) URL.revokeObjectURL(preview.url)
        preview.url = URL.createObjectURL(blob)
        preview.abierta = true
      } catch (e) {
        err(e.message)
      } finally {
        preview.cargando = false
      }
    },

    descargar(nombre) {
      if (!preview.url) return
      const a = document.createElement('a')
      a.href = preview.url
      a.download = nombre
      document.body.appendChild(a)
      a.click()
      a.remove()
    },

    // Imprimir lo abre en el visor del navegador, que es el que sabe imprimir un
    // PDF. window.print() de aquí imprimiría la pantalla, no la hoja.
    imprimir() {
      if (preview.url) window.open(preview.url, '_blank')
    },

    cerrar() {
      preview.abierta = false
    }
  })

  // Al cerrar se suelta el blob: si no, va acumulándose en memoria.
  watch(() => preview.abierta, (v) => {
    if (v || !preview.url) return
    URL.revokeObjectURL(preview.url)
    preview.url = ''
  })

  return preview
}
