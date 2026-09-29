/**
 * Se ejecuta después de `vite build` y deja el index.html más ligero:
 *
 *  1. Mete el CSS de la portada dentro del propio HTML. Quita una petición en
 *     cada visita (y sale en brotli, que es como comprime el proxy el HTML).
 *  2. Adelanta con `<link rel="modulepreload">` el fichero de la pantalla a la
 *     que se entra, para que se descargue mientras se ejecuta el JavaScript
 *     principal en vez de esperar a que éste arranque y pida el import().
 *
 * En la red de Camagüey cada petición son unos 250 ms: entre las dos cosas se
 * ahorran dos viajes antes de la primera pintura.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const fichero = join(dist, 'index.html')
let html = readFileSync(fichero, 'utf8')

// 1) CSS de la portada en línea.
const cssRef = html.match(/<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"[^>]*>/)
if (cssRef) {
  const ruta = join(dist, cssRef[1])
  const css = readFileSync(ruta, 'utf8')
  if (css.length <= 64 * 1024) {
    html = html.replace(cssRef[0], `<style>${css}</style>`)
    // El fichero se deja en dist por si una pestaña abierta con el HTML anterior
    // aún lo pide: si faltara, le llega el HTML en vez del CSS y se queda sin
    // estilo. Cuesta 11 kB que casi nadie descarga.
    console.log(`postbuild: CSS en línea, ${(css.length / 1024).toFixed(1)} kB (${cssRef[1]})`)
  } else {
    console.log(`postbuild: el CSS pesa ${(css.length / 1024).toFixed(1)} kB, se deja aparte`)
  }
}

// 2) Módulo de la pantalla de entrada, adelantado.
const assets = readdirSync(join(dist, 'assets'))
const pantalla = (nombre) => assets.find((f) => new RegExp(`^${nombre}-[\\w-]+\\.js$`).test(f))
const mapa = {
  login: pantalla('LoginView'),
  inicio: pantalla('DashboardView'),
  activos: pantalla('ActivosView'),
  utiles: pantalla('UtilesView'),
  responsables: pantalla('ResponsablesView'),
  areas: pantalla('AreasView')
}
const adelanto = `<script>
(function () {
  var mapa = ${JSON.stringify(mapa)};
  var p = location.pathname;
  var clave = p.indexOf('/login') === 0 ? 'login'
    : p.indexOf('/activos') === 0 ? 'activos'
    : p.indexOf('/utiles') === 0 ? 'utiles'
    : p.indexOf('/responsables') === 0 ? 'responsables'
    : p.indexOf('/areas') === 0 ? 'areas' : 'inicio';
  var fichero = mapa[clave];
  if (!fichero) return;
  var l = document.createElement('link');
  l.rel = 'modulepreload';
  l.href = '/assets/' + fichero;
  document.head.appendChild(l);
})();
</script>`

if (html.includes('</head>')) {
  html = html.replace('</head>', `  ${adelanto}\n  </head>`)
  console.log('postbuild: módulo de la pantalla de entrada adelantado')
} else {
  console.log('postbuild: sin </head>, no se adelanta nada')
}

writeFileSync(fichero, html)
