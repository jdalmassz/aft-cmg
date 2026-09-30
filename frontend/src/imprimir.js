/**
 * Imprimir desde el navegador.
 *
 * Un .xlsx no se puede imprimir aquí: eso lo hace Excel. Lo que sí se puede es
 * montar una hoja limpia con el listado y pasarle la impresión del navegador,
 * que desde el diálogo también deja guardar en PDF.
 *
 * Se imprime dentro de un iframe con su propio documento (nunca la pantalla de
 * la aplicación): así no se lleva por delante los cajones, los filtros ni el
 * lateral, y la cabecera se repite en cada página.
 */
const escapar = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// columnas: [{ t: 'Código', clase?: 'num' }]  filas: [[valor, valor, …]]
export function construirDocumento({ titulo, subtitulo, columnas, filas, pie }) {
  const cab = columnas.map((c) => `<th${c.clase ? ` class="${c.clase}"` : ''}>${escapar(c.t)}</th>`).join('')
  const cuerpo = filas
    .map((f) => '<tr>' + f.map((v, i) => `<td${columnas[i]?.clase ? ` class="${columnas[i].clase}"` : ''}>${escapar(v)}</td>`).join('') + '</tr>')
    .join('')
  const fecha = new Date().toLocaleDateString('es-CU', { day: '2-digit', month: 'long', year: 'numeric' })
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapar(titulo)}</title><style>
  @page { size: letter portrait; margin: 14mm 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #111; margin: 0; }
  h1 { font-size: 13pt; margin: 0 0 2pt; }
  .sub { font-size: 8.5pt; color: #444; margin: 0 0 10pt; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { border: .5pt solid #9a9a9a; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #efefef; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .2pt; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; }
  .pie { margin-top: 9pt; font-size: 8pt; color: #555; }
</style></head>
<body>
  <h1>${escapar(titulo)}</h1>
  <p class="sub">${escapar(subtitulo)}</p>
  <table><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table>
  <p class="pie">${escapar(pie || `Impreso desde AFT Camagüey · ${fecha}`)}</p>
</body></html>`
}

/**
 * El marco oculto donde se imprime. Nunca la pantalla de la aplicación.
 *
 * `pdf` cambia CÓMO se esconde, y no es un detalle: un PDF lo dibuja el visor del
 * navegador, y un visor metido en un marco de 1x1 con `opacity:0` no llega a dibujar
 * nada — manda a la impresora una hoja EN BLANCO. Pasó el 30/09/2026 al cambiar la
 * impresión de la vista previa: salía el diálogo a la primera, y salía vacío.
 *
 * Para un PDF hace falta tamaño de hoja de verdad, así que se esconde SACÁNDOLO de la
 * pantalla en vez de encogiéndolo. Nada de `opacity`, `visibility` ni `display:none`:
 * las tres apagan el dibujado y vuelven a dejar la hoja en blanco.
 *
 * Para HTML da igual: ahí el motor de impresión rehace la maquetación por su cuenta.
 */
function marcoOculto({ pdf = false } = {}) {
  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.style.cssText = pdf
    ? 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0'
    : 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
  return marco
}

/**
 * Lanza el diálogo del navegador sobre ese marco, y lo quita cuando toca.
 *
 * El marco NO se quita a los 15 segundos como antes: si el diálogo sigue abierto —y
 * con una hoja de conteo larga se queda abierto un rato— quitarlo cancela la
 * impresión por debajo. Se espera a `afterprint`, y el plazo de respaldo es largo.
 */
function lanzar(marco) {
  const limpiar = () => { try { marco.remove() } catch (_) { /* ya se fue */ } }
  try {
    const w = marco.contentWindow
    w.focus()
    w.addEventListener('afterprint', limpiar, { once: true })
    w.print()
  } catch (_) {
    limpiar()
    return false
  }
  setTimeout(limpiar, 120000)
  return true
}

export function imprimirDocumento(html) {
  const marco = marcoOculto()
  marco.addEventListener('load', () => {
    // UN iframe recién insertado dispara un `load` de `about:blank` ANTES de que
    // cargue el `srcdoc`. Ese primer aviso llegaba con el documento vacío, se
    // imprimía la nada, y había que volver a darle. Se ignora hasta que el
    // documento tiene de verdad lo que se quiere imprimir.
    const doc = marco.contentDocument
    if (!doc || !doc.body || !doc.body.firstChild) return
    lanzar(marco)
  })
  document.body.appendChild(marco)
  marco.srcdoc = html
}

/**
 * Imprimir un PDF que ya está en un blob.
 *
 * Antes esto hacía `window.open(url, '_blank')`, que NO imprime: abre otra pestaña y
 * deja al que la pidió teniendo que buscar el botón de imprimir dentro del visor. Y si
 * el navegador bloquea la ventana emergente —que es lo normal cuando salta sola— no
 * pasa nada visible y hay que volver a darle. De ahí lo de «tengo que dar imprimir tres
 * veces» (Arais, contado por Jose el 30/09/2026).
 *
 * Ahora el PDF se carga en el marco oculto y se imprime desde ahí: un clic, un diálogo.
 * Si el navegador no deja imprimir un PDF incrustado, entonces sí se abre la pestaña —
 * pero como respaldo, no como camino normal.
 */
export function imprimirPdf(url) {
  const marco = marcoOculto({ pdf: true })
  let hecho = false
  marco.addEventListener('load', () => {
    if (hecho) return
    hecho = true
    if (!lanzar(marco)) window.open(url, '_blank')
  })
  marco.addEventListener('error', () => {
    if (hecho) return
    hecho = true
    window.open(url, '_blank')
  })
  document.body.appendChild(marco)
  marco.src = url
}
