// La fecha de adquisición se guarda como la traía el Excel original: texto
// «19-6-26» (d-m-aa, sin ceros delante). El formulario usa un calendario
// (input type="date"), que habla ISO («2026-06-19»), así que aquí se traduce
// de un lado a otro. El formato guardado NO cambia.

// «19-6-26», «19-6-2026», «19/06/2026» o «2026-06-19» → «2026-06-19».
// Si no se entiende (o la fecha no existe, como 30-2), devuelve ''.
export function aIso(texto) {
  const t = String(texto || '').trim()
  if (!t) return ''
  let dia, mes, anio
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) {
    anio = Number(m[1]); mes = Number(m[2]); dia = Number(m[3])
  } else {
    m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/)
    if (!m) return ''
    dia = Number(m[1]); mes = Number(m[2])
    anio = Number(m[3])
    if (anio < 100) anio += anio < 70 ? 2000 : 1900
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return ''
  // Que el día exista de verdad en ese mes (29-2 sólo en año bisiesto…)
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return ''
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// «2026-06-19» → «19-6-26» (como el original: sin ceros delante y con el año
// de dos cifras). Vacío o ilegible → ''.
export function aTexto(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ''
  return `${Number(m[3])}-${Number(m[2])}-${m[1].slice(-2)}`
}
