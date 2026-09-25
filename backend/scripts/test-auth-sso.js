// Pruebas de la integración con Accesos que NO necesitan base de datos:
//   node scripts/test-auth-sso.js
//
// Cubre lo que ya costó caro una vez: la tabla de los siete roles (que el
// desconocido caiga al de MENOS permisos), la traducción del slug de la
// sucursal, la firma HMAC con la clave leída en hexadecimal, el returnTo y el
// alcance por sucursal.

const assert = require('assert');
const crypto = require('crypto');

// Hay que poner el entorno ANTES de requerir nada: los módulos lo leen al cargar.
process.env.AFT_AUTH_SIGNING_KEY = 'ab'.repeat(32); // 64 hex = 32 bytes
process.env.AFT_AUTH_CLIENT_ID = 'aft';
process.env.AFT_AUTH_URL = 'https://auth.procovar.cloud';

const sso = require('../src/procovar-auth');
const alcance = require('../src/alcance');
const { buildWhere } = require('../src/activos-query');

let n = 0;
function ok(nombre, fn) {
  n += 1;
  fn();
  console.log(`  ${n}. ${nombre}`);
}

const req = (protocol = 'https', host = 'aft.procovar.cloud') => ({ protocol, get: () => host });

console.log('Roles (los siete, comparados como texto)');

const ESPERADOS = {
  DESARROLLADOR: 'admin',
  'SUPER ADMIN': 'admin',
  GERENTE: 'usuario',
  ADMINISTRADOR: 'usuario', // de UNA sucursal: ésa es la fuga si sale admin
  SUPERVISOR: 'usuario',
  GESTOR: 'usuario',
  OPERADOR: 'usuario'
};

ok('los siete roles de Accesos están en la tabla', () => {
  assert.deepStrictEqual([...sso.ROLES_ACCESOS].sort(), Object.keys(ESPERADOS).sort());
});

for (const [rol, esperado] of Object.entries(ESPERADOS)) {
  ok(`rolInterno('${rol}') → ${esperado}`, () => assert.strictEqual(sso.rolInterno(rol), esperado));
}

ok('un rol desconocido cae al de MENOS permisos', () => {
  for (const rol of ['AUDITOR', 'nuevo-rol', '', null, undefined]) {
    assert.strictEqual(sso.rolInterno(rol), 'usuario', `rol: ${JSON.stringify(rol)}`);
  }
});

ok('el rol se compara como texto pero sin depender de mayúsculas ni espacios', () => {
  assert.strictEqual(sso.rolInterno('supervisor'), 'usuario');
  assert.strictEqual(sso.rolInterno('  SUPER ADMIN  '), 'admin');
  assert.strictEqual(sso.normalizaRol('gestor'), 'GESTOR');
  assert.strictEqual(sso.normalizaRol('lo-que sea'), null);
});

ok('sólo DESARROLLADOR y SUPER ADMIN ven las ocho sucursales', () => {
  for (const rol of sso.ROLES_ACCESOS) {
    const esperado = rol === 'DESARROLLADOR' || rol === 'SUPER ADMIN';
    assert.strictEqual(sso.rolVeTodasLasSucursales(rol), esperado, rol);
  }
  assert.strictEqual(sso.rolVeTodasLasSucursales('QUE SEA'), false);
});

console.log('Sucursales (el slug de Accesos ES el código, en minúscula)');

ok('las ocho sucursales con su nombre de la base', () => {
  assert.strictEqual(sso.sucursalDesdeSlug('cam'), 'CAM');
  assert.strictEqual(sso.nombreSucursal('CAM'), 'Camagüey');
  assert.strictEqual(sso.nombreSucursal('cam'), 'Camagüey'); // normaliza
  assert.strictEqual(sso.nombreSucursal('HOL'), 'Holguín');
  assert.strictEqual(sso.nombreSucursal('STG'), 'Santiago');
  assert.strictEqual(Object.keys(sso.SUCURSALES).length, 8);
});

ok('un slug que no es de las ocho → sin sucursal', () => {
  assert.strictEqual(sso.sucursalDesdeSlug('madrid'), null);
  assert.strictEqual(sso.sucursalDesdeSlug(''), null);
  assert.strictEqual(sso.sucursalDesdeSlug(undefined), null);
  assert.strictEqual(sso.nombreSucursal('nada'), null);
});

ok('se queda con la primera membresía (la más reciente)', () => {
  const members = [
    { organization: { slug: 'hol', name: 'Holguín' }, roles: ['GESTOR'] },
    { organization: { slug: 'cam', name: 'Camagüey' }, roles: ['SUPER ADMIN'] }
  ];
  assert.strictEqual(sso.sucursalDesdeMemberships(members), 'HOL');
  assert.strictEqual(sso.sucursalDesdeMemberships([]), null);
  assert.strictEqual(sso.sucursalDesdeMemberships(null), null);
});

console.log('Firma HMAC-SHA256 (MÉODO\\nruta\\nmarca\\nnonce\\nhash)');

ok('la firma se calcula con la clave en hexadecimal', () => {
  const cuerpo = JSON.stringify({ code: 'abc' });
  const h = sso.headersFirma('POST', '/api/auth/exchange', cuerpo);
  assert.strictEqual(h['x-client-id'], 'aft');
  assert.ok(/^\d{10}$/.test(h['x-timestamp']), 'marca en segundos');
  assert.ok(/^[0-9a-f]{32}$/.test(h['x-nonce']), 'nonce de 16 bytes en hex');
  const hash = crypto.createHash('sha256').update(cuerpo, 'utf8').digest('hex');
  const data = `POST\n/api/auth/exchange\n${h['x-timestamp']}\n${h['x-nonce']}\n${hash}`;
  const esperada = crypto.createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(data).digest('hex');
  assert.strictEqual(h['x-signature'], esperada);
  assert.notStrictEqual(
    h['x-signature'],
    crypto.createHmac('sha256', 'ab'.repeat(32)).update(data).digest('hex'),
    'como texto plano saldría otra firma (y Accesos contesta 401)'
  );
});

ok('el hash del cuerpo en un GET es el de la cadena vacía', () => {
  const h = sso.headersFirma('GET', '/api/auth/callback-token', '');
  const hash = crypto.createHash('sha256').update('', 'utf8').digest('hex');
  const data = `GET\n/api/auth/callback-token\n${h['x-timestamp']}\n${h['x-nonce']}\n${hash}`;
  assert.strictEqual(h['x-signature'], crypto.createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(data).digest('hex'));
});

console.log('returnTo (lo que se comprueba es lo que se usa)');

ok('acepta una ruta relativa a la propia raíz', () => {
  assert.strictEqual(sso.destinoSeguro('/activos', req()), true);
  assert.strictEqual(sso.safeReturnTo({ ...req(), query: { returnTo: '/activos' } }), 'https://aft.procovar.cloud/activos');
});

ok('acepta la URL absoluta de su propio origen', () => {
  assert.strictEqual(sso.destinoSeguro('https://aft.procovar.cloud/inicio', req()), true);
});

ok('rechaza todo lo que no sea de este origen', () => {
  assert.strictEqual(sso.destinoSeguro('https://otro.com/activos', req()), false);
  assert.strictEqual(sso.destinoSeguro('//otro.com', req()), false);
  assert.strictEqual(sso.destinoSeguro('javascript:alert(1)', req()), false);
  assert.strictEqual(sso.destinoSeguro('https://aft.procovar.cloud/activos?x=1', req()), false);
  assert.strictEqual(sso.destinoSeguro(undefined, req()), false);
  assert.strictEqual(sso.destinoSeguro('/activos', req('http', 'localhost:8080')), true, 'en local también');
});

ok('sin returnTo válido se va a /inicio', () => {
  assert.strictEqual(sso.safeReturnTo({ ...req(), query: { returnTo: 'https://otro.com' } }), 'https://aft.procovar.cloud/inicio');
  assert.strictEqual(sso.safeReturnTo({ ...req(), query: {} }), 'https://aft.procovar.cloud/inicio');
});

ok('origenPublico sale de la petición, no de una variable', () => {
  assert.strictEqual(sso.origenPublico(req('http', 'localhost:5173')), 'http://localhost:5173');
  assert.strictEqual(sso.origenPublico(req()), 'https://aft.procovar.cloud');
});

console.log('Alcance por sucursal (cada sucursal sólo ve sus datos)');

const cuentaLocal = { rol: 'usuario', email: null, sucursal: null, rol_accesos: null };
const cmg = { rol: 'usuario', email: 'x@y.cu', sucursal: 'CAM', rol_accesos: 'SUPERVISOR' };
const hol = { rol: 'usuario', email: 'z@y.cu', sucursal: 'HOL', rol_accesos: 'GESTOR' };
const global = { rol: 'admin', email: 'g@y.cu', sucursal: 'CAM', rol_accesos: 'SUPER ADMIN' };
const sucursalRara = { rol: 'usuario', email: 'r@y.cu', sucursal: 'XYZ', rol_accesos: 'OPERADOR' };

const sqlDe = (user) => {
  const params = [];
  const cond = alcance.condicionSucursal(user, (v) => { params.push(v); return `$${params.length}`; });
  return { cond, params };
};

ok('una cuenta local es de Camagüey (éste es el sistema de Camagüey)', () => {
  assert.strictEqual(alcance.sucursalDe(cuentaLocal), 'CAM');
  assert.strictEqual(alcance.sucursalDe(cmg), 'CAM');
  assert.strictEqual(alcance.sucursalDe(global), 'CAM');
  // Vino de Accesos y su sucursal no existe aquí → sin sucursal
  assert.strictEqual(alcance.sucursalDe(hol), 'HOL');
  assert.strictEqual(alcance.sucursalDe({ ...hol, sucursal: null }), null);
});

ok('los que ven las ocho no se filtran', () => {
  assert.strictEqual(alcance.condicionSucursal(global, () => '$1'), null);
  assert.strictEqual(sqlDe(global).cond, null);
});

ok('Camagüey sólo ve los activos de Camagüey', () => {
  const { cond, params } = sqlDe(cmg);
  assert.strictEqual(cond, 'a.sucursal_id IN (SELECT id FROM sucursales WHERE nombre = $1)');
  assert.deepStrictEqual(params, ['Camagüey']);
});

ok('quien no tiene sucursal conocida no ve nada (pero entra)', () => {
  // Sucursal de fuera de las ocho, o vino de Accesos sin membresía: FALSE.
  assert.strictEqual(sqlDe(sucursalRara).cond, 'FALSE');
  assert.strictEqual(sqlDe({ ...hol, sucursal: null }).cond, 'FALSE');
  // Sucursal conocida pero sin datos en la base: la consulta no devuelve filas
  // (en cuanto exista la sucursal en `sucursales`, empieza a ver lo suyo).
  const { cond, params } = sqlDe(hol);
  assert.strictEqual(cond, 'a.sucursal_id IN (SELECT id FROM sucursales WHERE nombre = $1)');
  assert.deepStrictEqual(params, ['Holguín']);
});

ok('una cuenta local sin sucursal guardada sigue viendo Camagüey', () => {
  assert.strictEqual(sqlDe(cuentaLocal).cond.includes("nombre = $1"), true);
  assert.deepStrictEqual(sqlDe(cuentaLocal).params, ['Camagüey']);
});

console.log('Filtros (buildWhere mezcla el alcance con los filtros de siempre)');

// El tipo va el PRIMERO de todos: TODA lectura pasa por aquí, y lo que se
// olvida es el parámetro —entonces sale 'AFT', el que no miente.
ok('con filtros y alcance, el orden de los parámetros cuadra', () => {
  const from = buildWhere({ q: 'laptop', estado: 'ACTIVO', user: cmg });
  assert.strictEqual(from.params.length, 6);
  assert.ok(from.sql.includes('a.sucursal_id IN (SELECT id FROM sucursales WHERE nombre = $6)'), from.sql);
  assert.deepStrictEqual(from.params, ['AFT', '%laptop%', '%laptop%', '%laptop%', 'ACTIVO', 'Camagüey']);
});

ok('sin tipo a la vista se filtran activos fijos, no útiles', () => {
  const from = buildWhere({ user: global });
  assert.ok(from.sql.includes('a.tipo = $1'), from.sql);
  assert.deepStrictEqual(from.params, ['AFT']);
});

ok('por la ruta de útiles el filtro pasa a UTIL', () => {
  const from = buildWhere({ tipo: 'UTIL', user: global });
  assert.ok(from.sql.includes('a.tipo = $1'), from.sql);
  assert.strictEqual(from.params[0], 'UTIL');
});

ok('sin sucursal conocida, la lista sale vacía', () => {
  const from = buildWhere({ user: sucursalRara });
  assert.strictEqual(from.sql, 'WHERE a.tipo = $1 AND FALSE');
  assert.deepStrictEqual(from.params, ['AFT']);
});

ok('quien ve las ocho no lleva condición de sucursal', () => {
  const from = buildWhere({ user: global });
  assert.ok(!from.sql.includes('sucursal_id'), from.sql);
});

console.log(`\n${n} comprobaciones correctas.`);
