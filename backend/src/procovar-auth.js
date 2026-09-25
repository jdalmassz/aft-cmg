// Integración con Accesos (SSO de Procovar).
// Esta lógica sale de leer procovar/delivery/src/lib/procovar-auth.ts y los endpoints
// de auth.procovar.cloud. No la reescribas de memoria: aquí está tal cual.
//
// Ver guía: ~/Downloads/Untitled (1).md

const crypto = require('crypto');

const AUTH_URL = process.env.AFT_AUTH_URL || 'https://auth.procovar.cloud';

// Cookie httpOnly donde el callback guarda el token. El frontend no puede
// leerla (ni borrarla con JS): el token viaja en ella y el navegador la
// envía automáticamente. El authMiddleware cae a ella cuando no hay Authorization.
const SSO_COOKIE = 'aft_sso';
// El clientId con el que AFT está dada de alta en Accesos. Va en la variable
// por si una instalación se registrara con otro nombre; el de casa es `aft`.
const CLIENT_ID = process.env.AFT_AUTH_CLIENT_ID || 'aft';
const SIGNING_KEY = process.env.AFT_AUTH_SIGNING_KEY;

// Las ocho sucursales. El slug de la organización ES el código, en minúscula:
// `cam`, `hol`. El nombre es el de la tabla `sucursales`.
const SUCURSALES = {
  cam: { codigo: 'CAM', nombre: 'Camagüey' },
  gr: { codigo: 'GR', nombre: 'Granma' },
  gto: { codigo: 'GTO', nombre: 'Guantánamo' },
  hab: { codigo: 'HAB', nombre: 'La Habana' },
  hol: { codigo: 'HOL', nombre: 'Holguín' },
  ss: { codigo: 'SS', nombre: 'Sancti Spíritus' },
  stg: { codigo: 'STG', nombre: 'Santiago' },
  tun: { codigo: 'TUN', nombre: 'Las Tunas' }
};

// Del slug de la organización al código de la sucursal.
// Si no la conocemos (o la persona no está en ninguna), devuelve null:
// entra igual, pero sin sucursal.
function sucursalDesdeSlug(slug) {
  if (!slug) return null;
  const s = SUCURSALES[String(slug).trim().toLowerCase()];
  return s ? s.codigo : null;
}

// Accesos devuelve las membresías de la más reciente a la más antigua y nos
// quedamos con la primera: hoy no hay nadie con dos, y adivinar la regla
// ahora sería inventarla.
function sucursalDesdeMemberships(memberships) {
  const m = Array.isArray(memberships) && memberships.length ? memberships[0] : null;
  const slug = m && m.organization ? m.organization.slug : null;
  return sucursalDesdeSlug(slug);
}

function nombreSucursal(codigo) {
  if (!codigo) return null;
  const c = String(codigo).trim().toUpperCase();
  const found = Object.values(SUCURSALES).find((s) => s.codigo === c);
  return found ? found.nombre : null;
}

function esSucursalValida(codigo) {
  return !!nombreSucursal(codigo);
}

// Delivery cae a 'delivery' por defecto; en aft-cmg NO ponemos valor por defecto.
// Si falta la variable, el login SSO simplemente no está disponible.
function loginUnicoDisponible() {
  return Boolean(SIGNING_KEY);
}

// La dirección de vuelta se calcula de la petición, no de una variable.
// Así funciona igual en local, pruebas y producción sin configurar nada,
// y no hay forma de que apunte a un sitio que ya no existe.
function origenPublico(req) {
  // Express 5 con trust proxy lee X-Forwarded-Proto/X-Forwarded-Host.
  return `${req.protocol}://${req.get('host')}`;
}

// El returnTo lo escribe quien quiera en la barra de direcciones.
// Se valida contra tu propio origen a la ida y a la vuelta:
// "lo que se comprueba es lo que se usa".
// Puede venir como ruta relativa (`/activos`, que es como lo manda el
// frontend) o como URL absoluta; en ambos casos se resuelve contra el origen
// público y se compara: una relativa a otro dominio, `//otro.com` o un
// `javascript:` no pasan.
function destinoSeguro(returnTo, req) {
  if (!returnTo || typeof returnTo !== 'string') return false;
  let u, o;
  try {
    const origen = origenPublico(req);
    u = new URL(returnTo, origen);
    o = new URL(origen);
  } catch {
    return false;
  }
  if (u.origin !== o.origin) return false;
  if (!u.pathname.startsWith('/')) return false;
  if (u.search || u.hash) return false;
  return true;
}

function pedidoReturnTo(req) {
  // El botón de entrada es un enlace GET (`?returnTo=/activos`), así que el
  // returnTo puede venir de la query; en POST vendría del body.
  return (req.query && req.query.returnTo) || (req.body && req.body.returnTo);
}

function safeReturnTo(req) {
  const rt = pedidoReturnTo(req);
  if (destinoSeguro(rt, req)) {
    // Accesos valida el returnTo contra sus dominios: hay que mandarle la URL
    // absoluta, aunque el enlace haya traído una ruta relativa (/activos).
    return new URL(rt, origenPublico(req)).toString();
  }
  return `${origenPublico(req)}/inicio`;
}

// Firma HMAC-SHA256 de las llamadas server-to-server.
// Lo que se firma son cinco cosas unidas por saltos de línea, en este orden:
//   MÉTODO\nruta\nmarca-de-tiempo\nnonce\nhash-del-cuerpo
function firmar(method, route, bodyStr) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(bodyStr || '', 'utf8').digest('hex');
  const data = `${method.toUpperCase()}\n${route}\n${ts}\n${nonce}\n${bodyHash}`;
  const signature = crypto.createHmac('sha256', Buffer.from(SIGNING_KEY, 'hex')).update(data).digest('hex');
  return { timestamp: ts, nonce, signature };
}

function headersFirma(method, route, bodyStr) {
  const { timestamp, nonce, signature } = firmar(method, route, bodyStr);
  return {
    'Content-Type': 'application/json',
    'x-client-id': CLIENT_ID,
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signature
  };
}

// Los roles son SIETE y se comparan como texto. Los dos primeros ven las ocho
// sucursales; los otros cinco pertenecen a una.
// Cáete siempre hacia el rol de MENOS permisos: un rol que no conozcas no puede
// acabar dando más permisos de los debidos.
//
// ATENCIÓN: cuando en Accesos se cree un rol nuevo, hay que añadirlo aquí.
// Si se olvida, quien entre con ese rol entra igual pero como `usuario` (no
// revienta nada, pero no verá las pantallas de administración) — y eso desde
// dentro parece que "no hay datos".
const ROLES_ACCESOS = [
  'DESARROLLADOR',
  'SUPER ADMIN',
  'GERENTE',
  'ADMINISTRADOR',
  'SUPERVISOR',
  'GESTOR',
  'OPERADOR'
];

// Ojo con ADMINISTRADOR: es de UNA sucursal. Cualquier comprobación del tipo
// «¿contiene admin?» le daría las ocho, y ésa es la fuga.
const ROLES_TODAS_LAS_SUCURSALES = new Set(['DESARROLLADOR', 'SUPER ADMIN']);

function normalizaRol(rol) {
  if (!rol) return null;
  const r = String(rol).trim().toUpperCase();
  return ROLES_ACCESOS.includes(r) ? r : null;
}

// Traducción de Accesos al rol interno. Éste es el ÚNICO sitio donde se hace:
// el resto de la aplicación sólo mira `rol`.
function rolInterno(rol) {
  const r = normalizaRol(rol);
  if (!r) return 'usuario'; // rol desconocido o vacío → el de menos permisos
  return ROLES_TODAS_LAS_SUCURSALES.has(r) ? 'admin' : 'usuario';
}

// Los que ven las ocho sucursales (y por tanto también Camagüey).
// Ojo: esto recibe el ROL de Accesos; el alcance de un usuario entero está en
// alcance.js y se decide por su rol interno.
function rolVeTodasLasSucursales(rol) {
  return ROLES_TODAS_LAS_SUCURSALES.has(normalizaRol(rol));
}

module.exports = {
  AUTH_URL,
  CLIENT_ID,
  SSO_COOKIE,
  SUCURSALES,
  ROLES_ACCESOS,
  sucursalDesdeSlug,
  sucursalDesdeMemberships,
  nombreSucursal,
  esSucursalValida,
  loginUnicoDisponible,
  origenPublico,
  destinoSeguro,
  safeReturnTo,
  firmar,
  headersFirma,
  normalizaRol,
  rolInterno,
  rolVeTodasLasSucursales
};