// Alcance por sucursal: cada sucursal sólo ve sus datos.
//
// Este sistema sólo tiene datos de Camagüey, pero la regla es general: la
// sucursal de la persona sale de Accesos (el slug de su organización) y sólo
// ve los activos de esa sucursal. Los dos roles globales (DESARROLLADOR y
// SUPER ADMIN) ven las ocho.
//
// Si la sucursal de la persona no existe en la base, ENTRA pero no ve nada:
// ver menos se nota y se arregla; dejarla fuera sin saber por qué no.

const sso = require('./procovar-auth');

// Las cuentas locales (las que se crean con /api/admin/users y no vienen de
// Accesos) son de Camagüey: éste es el sistema de Camagüey. Se distinguen
// porque no tienen correo — el correo es la identidad compartida con Accesos,
// y sólo de ahí sale. Quien viene de Accesos lo lleva siempre, aunque su
// sucursal no exista aquí (y en ese caso no ve nada).
const SUCURSAL_LOCAL = 'CAM';

function sucursalDe(user) {
  if (!user) return null;
  if (user.sucursal) return user.sucursal;
  if (!user.email) return SUCURSAL_LOCAL;
  return null;
}

// El rol interno 'admin' sólo lo tienen DESARROLLADOR y SUPER ADMIN (los que
// ven las ocho sucursales) y el admin local: la traducción vive en
// procovar-auth.js, aquí no se decide nada de roles.
function veTodasLasSucursales(user) {
  return !!user && user.rol === 'admin';
}

// Condición SQL que tiene que cumplir un activo para que ese usuario lo vea.
// `p` empuja un parámetro y devuelve su placeholder; `alias` es la tabla
// `activos` dentro del query. Devuelve `null` si no hay que filtrar.
function condicionSucursal(user, p, alias = 'a') {
  if (veTodasLasSucursales(user)) return null;
  const nombre = sso.nombreSucursal(sucursalDe(user));
  // Sin sucursal en la base: la condición nunca se cumple y no ve nada.
  if (!nombre) return 'FALSE';
  return `${alias}.sucursal_id IN (SELECT id FROM sucursales WHERE nombre = ${p(nombre)})`;
}

// Para escrituras. Devuelve:
//   { todas: true }            → puede escribir en cualquier sucursal
//   { todas: false, id: n }    → sólo en la suya
//   null                       → su sucursal no existe en la base; no debería
//                                crear datos que después no podrá ver.
async function alcanceEscritura(pool, user) {
  if (veTodasLasSucursales(user)) return { todas: true };
  const nombre = sso.nombreSucursal(sucursalDe(user));
  if (!nombre) return null;
  const r = await pool.query('SELECT id FROM sucursales WHERE nombre = $1', [nombre]);
  if (r.rowCount === 0) return null;
  return { todas: false, id: r.rows[0].id };
}

module.exports = {
  SUCURSAL_LOCAL,
  sucursalDe,
  veTodasLasSucursales,
  condicionSucursal,
  alcanceEscritura
};
