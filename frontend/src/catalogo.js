import { api } from './api'

/**
 * El catálogo (áreas, ubicaciones, responsables, marcas, categorías) lo necesitan
 * varias pantallas y cambia pocas veces.
 *
 * Antes cada pantalla lo pedía al montarse: entrar en Inventario, salir a Útiles y
 * volver a entrar eran tres idas a la base (media segunda cada una, de las que la
 * mitad es sólo ida y vuelta de red). Aquí se pide una vez y se guarda, con un
 * tiempo de vida corto para que un área nueva se vea pronto sin tener que
 * recargar la página.
 */
let cache = null
let cuando = 0
let enCurso = null
const TTL_MS = 60 * 1000

export function getCatalogo({ forzar = false } = {}) {
  const ahora = Date.now()
  if (!forzar && cache && ahora - cuando < TTL_MS) return Promise.resolve(cache)
  // Si alguien ya lo está pidiendo, no se pide otra vez a la vez.
  if (enCurso && !forzar) return enCurso
  enCurso = api
    .get('/api/catalogo')
    .then((c) => {
      cache = c
      cuando = Date.now()
      return c
    })
    .finally(() => { enCurso = null })
  return enCurso
}

/** Para cuando cambia algo del catálogo (áreas, ubicaciones, responsables). */
export function invalidarCatalogo() {
  cache = null
  cuando = 0
}
