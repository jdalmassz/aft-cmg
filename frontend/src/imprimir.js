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

export function imprimirDocumento(html) {
  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  // No display:none: algunos navegadores se saltan la impresión de un iframe oculto.
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0'
  const limpiar = () => { try { marco.remove() } catch (_) { /* ya se fue */ } }
  marco.addEventListener('load', () => {
    try {
      const w = marco.contentWindow
      w.focus()
      w.print()
    } catch (_) { /* el navegador decide */ }
    // El diálogo puede tardar: se quita pasados unos segundos o al terminar.
    window.addEventListener('afterprint', limpiar, { once: true })
    setTimeout(limpiar, 15000)
  })
  document.body.appendChild(marco)
  marco.srcdoc = html
}
