// Prueba de extremo a extremo de la entrada por Accesos, contra una base de
// datos PostgreSQL de verdad y con un doble de Accesos que COMPRUEBA la firma.
//
//   node scripts/test-e2e-sso.js
//
// Necesita un PostgreSQL accesible (por defecto el de `docker compose up -d db`,
// o las variables PGHOST/PGPORT/PGUSER/PGPASSWORD). Crea una base efímera
// `aft_e2e_<timestamp>` y la borra al terminar: no toca tus datos.
//
// Lo que comprueba, en el orden del documento:
//   1. la firma de las dos llamadas (si falla, Accesos contesta 401 y aquí
//      se ve como ?sso=error)
//   2. que el callbackUrl va exactamente como se dio de alta
//   3. el salto entero y el returnTo de vuelta a la pantalla de la que salías
//   4. que la persona, su rol de los siete y su sucursal quedan guardados
//   5. que cada sucursal sólo ve sus datos (Camagüey, la única con datos)
//   6. que sin clave no se revienta: se cae al login de siempre

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawn } = require('child_process');
const { Client } = require('pg');

const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'aft',
  password: process.env.PGPASSWORD || 'aft_cmg_secreto'
};

const CLAVE = 'ab'.repeat(32);
const CLIENT_ID = 'aft';
const APP_PUERTO = 8091;
const APP_PUERTO_SIN_CLAVE = 8092;
const MOCK_PUERTO = 8099;
const APP = `http://127.0.0.1:${APP_PUERTO}`;

let fallos = 0;
let n = 0;
function ok(nombre, cond, detalle) {
  n += 1;
  if (cond) {
    console.log(`  ${n}. ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ${n}. FALLO — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  }
}

// ---------------------------------------------------------------- peticiones
function pedido({ url, metodo = 'GET', cookie, auth, cuerpo, seguir = false }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (auth) headers.Authorization = `Bearer ${auth}`;
    let body;
    if (cuerpo !== undefined) {
      body = JSON.stringify(cuerpo);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers },
      async (res) => {
        const trozos = [];
        for await (const t of res) trozos.push(t);
        const texto = Buffer.concat(trozos).toString('utf8');
        const loc = res.headers.location;
        if (seguir && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          const destino = new URL(loc, u.origin).toString();
          const setCookie = res.headers['set-cookie'];
          return resolve(
            await pedido({
              url: destino,
              metodo: res.statusCode === 303 ? 'GET' : metodo,
              cookie: cookie || (setCookie ? setCookie.map((c) => c.split(';')[0]).join('; ') : undefined),
              auth,
              cuerpo: res.statusCode === 303 ? undefined : cuerpo,
              seguir: true
            })
          );
        }
        resolve({ status: res.statusCode, headers: res.headers, body: texto, url: u.toString() });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const json = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const cookieDe = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

// ------------------------------------------------------------- doble de Accesos
// Hace lo mismo que hace Accesos: valida clientId y firma (y rechaza si no),
// devuelve la dirección de ida, redirige a tu callback con un código de un solo
// uso de 60 segundos y lo canjea por la persona y sus sucursales.
function crearAccesos(escenario) {
  const estado = { pendiente: null, codes: new Map() };

  const server = http.createServer(async (req, res) => {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const cuerpo = Buffer.concat(trozos).toString('utf8');

    const firmado = () => {
      const cid = req.headers['x-client-id'];
      const ts = req.headers['x-timestamp'];
      const nonce = req.headers['x-nonce'];
      const firma = req.headers['x-signature'];
      if (cid !== CLIENT_ID) return { ok: false, status: 403, error: 'client_id_no_coincide' };
      const edad = Math.abs(Date.now() / 1000 - Number(ts));
      if (!Number.isFinite(edad) || edad > 300) return { ok: false, status: 401, error: 'timestamp_fuera_de_rango' };
      const hash = crypto.createHash('sha256').update(cuerpo, 'utf8').digest('hex');
      const data = `${req.method}\n${req.url}\n${ts}\n${nonce}\n${hash}`;
      const esperada = crypto.createHmac('sha256', Buffer.from(CLAVE, 'hex')).update(data).digest('hex');
      if (esperada !== firma) return { ok: false, status: 401, error: 'firma_invalida' };
      return { ok: true };
    };

    const devolver = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'POST' && req.url === '/api/auth/callback-token') {
      const f = firmado();
      if (!f.ok) return devolver(f.status, { error: f.error });
      const b = JSON.parse(cuerpo || '{}');
      // allowedCallbackUrls: se compara ORIGEN Y RUTA, entero.
      const permitidas = [`${APP}/api/auth/sso/callback`];
      if (!permitidas.includes(b.callbackUrl)) {
        return devolver(400, { error: 'callbackUrl_no_permitida', recibida: b.callbackUrl });
      }
      estado.pendiente = { returnTo: b.returnTo, callbackUrl: b.callbackUrl };
      return devolver(200, {
        token: 'mock',
        expiresIn: 60,
        redirectUrl: `http://127.0.0.1:${MOCK_PUERTO}/identificar`
      });
    }

    if (req.method === 'GET' && req.url.startsWith('/identificar')) {
      // Aquí se identificaría la persona; aquí ya lo está "de toda la vida".
      const code = crypto.randomBytes(16).toString('hex');
      estado.codes.set(code, { usado: false });
      const cb = estado.pendiente.callbackUrl;
      res.writeHead(302, { Location: `${cb}?code=${code}` });
      return res.end();
    }

    if (req.method === 'POST' && req.url === '/api/auth/exchange') {
      const f = firmado();
      if (!f.ok) return devolver(f.status, { error: f.error });
      const { code } = JSON.parse(cuerpo || '{}');
      const guardado = estado.codes.get(code);
      // 60 segundos, un solo uso, atado al clientId.
      if (!guardado || guardado.uso) return devolver(401, { code: 'invalid_or_expired_code', error: 'invalid_or_expired_code' });
      guardado.uso = true;
      return devolver(200, {
        user: escenario.user,
        memberships: escenario.memberships,
        returnTo: estado.pendiente.returnTo
      });
    }

    // Entrada directa: la pantalla de login de la app manda el correo y la
    // contraseña y NO se sale de la página. /token va sin firma; /verify, con ella.
    if (req.method === 'POST' && req.url === '/api/auth/token') {
      const b = JSON.parse(cuerpo || '{}');
      if (!b.email || !b.password) return devolver(400, { error: 'invalid_body' });
      if (b.email !== escenario.email || b.password !== escenario.password) {
        return devolver(401, { error: 'invalid_credentials' });
      }
      return devolver(200, { access_token: `mock-${b.email}`, token_type: 'Bearer', expires_in: 3600 });
    }

    if (req.method === 'POST' && req.url === '/api/auth/verify') {
      const f = firmado();
      if (!f.ok) return devolver(f.status, { error: f.error });
      const b = JSON.parse(cuerpo || '{}');
      if (!b.token) return devolver(400, { error: 'invalid_body' });
      if (!String(b.token).startsWith('mock-')) return devolver(401, { error: 'invalid_token' });
      return devolver(200, { user: escenario.user, memberships: escenario.memberships });
    }

    devolver(404, { error: 'no_encontrado' });
  });

  return new Promise((resolve) => server.listen(MOCK_PUERTO, '127.0.0.1', () => resolve({ server, estado })));
}

// ------------------------------------------------------------------ servidores
function arrancar(env) {
  const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let registro = '';
  hijo.stdout.on('data', (d) => { registro += d; });
  hijo.stderr.on('data', (d) => { registro += d; });
  hijo.registro = () => registro;
  return hijo;
}

async function esperarSalud(puerto, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await pedido({ url: `http://127.0.0.1:${puerto}/health` });
      if (r.status === 200) return true;
    } catch { /* aún no está */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`El servidor en el puerto ${puerto} no arrancó`);
}

function baseDatos() {
  return new Client({ host: PG.host, port: PG.port, user: PG.user, password: PG.password, database: 'postgres' });
}

async function crearBase(nombre) {
  const c = await baseDatos();
  await c.connect();
  await c.query(`CREATE DATABASE ${nombre}`);
  await c.end();
}

async function borrarBase(nombre) {
  const c = await baseDatos();
  await c.connect();
  await c.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [nombre]
  );
  await c.query(`DROP DATABASE IF EXISTS ${nombre}`);
  await c.end();
}

// --------------------------------------------------------------- el salto entero
// Un turno = entrar, identificarse y volver al callback.
async function entrar(returnTo) {
  const destino = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  const ida = await pedido({ url: `${APP}/api/auth/entrar${destino}` });
  if (ida.status !== 302) return { error: `entrar devolvió ${ida.status}: ${ida.body.slice(0, 120)}` };
  const identificacion = await pedido({ url: ida.headers.location });
  if (identificacion.status !== 302) return { error: `identificar devolvió ${identificacion.status}` };
  const vuelta = await pedido({ url: identificacion.headers.location });
  return {
    status: vuelta.status,
    destino: vuelta.headers.location,
    cookie: cookieDe(vuelta),
    cruda: (vuelta.headers['set-cookie'] || []).join(' '),
    cuerpo: vuelta.body
  };
}

// Segundo argumento: cookie (sesión por Accesos). Tercero: token JWT (login local).
const get = (ruta, cookie, auth) => pedido({ url: `${APP}${ruta}`, cookie, auth });
const post = (ruta, cookie, cuerpo, auth) => pedido({ url: `${APP}${ruta}`, metodo: 'POST', cookie, cuerpo, auth });

// ---------------------------------------------------------------------- main
(async function main() {
  const bd = `aft_e2e_${Date.now()}`;
  let servidorSinClave;
  let accesos;
  let app;

  try {
    await crearBase(bd);
    console.log(`Base efímera: ${bd} en ${PG.host}:${PG.port}`);

    const escenario = { user: null, memberships: null };
    accesos = await crearAccesos(escenario);

    const bdUrl = `postgres://${PG.user}${PG.password ? `:${PG.password}` : ''}@${PG.host}:${PG.port}/${bd}`;
    const entorno = {
      // DATABASE_URL manda sobre PG* y además neutraliza un backend/.env suelto.
      DATABASE_URL: bdUrl,
      PGHOST: PG.host,
      PGPORT: String(PG.port),
      PGUSER: PG.user,
      PGPASSWORD: PG.password,
      PGDATABASE: bd,
      PORT: String(APP_PUERTO),
      JWT_SECRET: 'secreto-de-prueba',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin123',
      AFT_AUTH_URL: `http://127.0.0.1:${MOCK_PUERTO}`,
      AFT_AUTH_CLIENT_ID: CLIENT_ID,
      AFT_AUTH_SIGNING_KEY: CLAVE
    };

    app = arrancar(entorno);
    await esperarSalud(APP_PUERTO);

    console.log('\n1. La firma y la lista de vueltas (paso 1 y 2 del documento)');
    escenario.user = { id: 'u1', email: 'maria@procovar.cu', name: 'MARIA PEREZ', isSystemAdmin: false };
    escenario.memberships = [{ organization: { slug: 'cam', name: 'Camagüey' }, roles: ['SUPERVISOR'] }];

    let r = await entrar('/activos');
    ok('el salto entero vuelve a la pantalla de la que salías', !r.error && r.destino === `${APP}/activos`, r.error || r.destino);
    const cruda = r.cruda || '';
    ok('emite cookie httpOnly con el token propio', /^aft_sso=[^;]+/.test(cruda) && cruda.toLowerCase().includes('httponly'), cruda);
    const cam = r.cookie;

    console.log('\n2. La persona de Accesos y su sucursal (paso 4)');
    let me = json(await get('/api/me', cam)).user;
    ok('rol interno SUPERVISOR → usuario', me.rol === 'usuario', me.rol);
    ok('sucursal sale del slug en mayúsculas (cam → CAM)', me.sucursal === 'CAM', me.sucursal);
    ok('se guarda el rol de Accesos tal cual', me.rol_accesos === 'SUPERVISOR', me.rol_accesos);
    ok('Camagüey sí tiene datos', me.sinDatos === false, String(me.sinDatos));

    let lista = json(await get('/api/activos', cam));
    ok('ve los 57 activos de su sucursal', lista.total === 57, String(lista.total));
    let dash = json(await get('/api/dashboard', cam));
    ok('el dashboard también está de su sucursal', dash.total === 57, String(dash.total));
    ok('no es admin, no administra', (await get('/api/admin/users', cam)).status === 403);
    ok('la sesión sobrevive a otra petición', (await get('/api/me', cam)).status === 200);

    console.log('\n3. Otra sucursal: entra pero no ve nada');
    escenario.user = { id: 'u2', email: 'pedro@procovar.cu', name: 'PEDRO GARCIA', isSystemAdmin: false };
    escenario.memberships = [{ organization: { slug: 'hol', name: 'Holguín' }, roles: ['GESTOR'] }];
    r = await entrar();
    const hol = r.cookie;
    me = json(await get('/api/me', hol)).user;
    ok('sucursal HOL', me.sucursal === 'HOL', me.sucursal);
    ok('se le avisa de que no tiene datos', me.sinDatos === true, String(me.sinDatos));
    lista = json(await get('/api/activos', hol));
    ok('no ve activos de Camagüey', lista.total === 0, String(lista.total));
    dash = json(await get('/api/dashboard', hol));
    ok('dashboard vacío, sin reventar', dash.total === 0, String(dash.total));
    ok('un activo suyo no existe para él (404, no 403)', (await get('/api/activos/1', hol)).status === 404);
    ok('ni su historial', json(await get('/api/activos/1/movimientos', hol)).movimientos.length === 0);
    ok('ni el listado global de movimientos', json(await get('/api/movimientos', hol)).movimientos.length === 0);

    console.log('\n4. Los dos roles que ven las ocho sucursales');
    escenario.user = { id: 'u3', email: 'jose@procovar.cu', name: 'JOSE', isSystemAdmin: false };
    escenario.memberships = [{ organization: { slug: 'hab', name: 'La Habana' }, roles: ['DESARROLLADOR'] }];
    r = await entrar();
    const dev = r.cookie;
    me = json(await get('/api/me', dev)).user;
    ok('DESARROLLADOR → rol admin', me.rol === 'admin', me.rol);
    ok('ve los datos aunque su sucursal sea La Habana', json(await get('/api/activos', dev)).total === 57);
    ok('y administra', (await get('/api/admin/users', dev)).status === 200);

    escenario.user = { id: 'u4', email: 'otro@procovar.cu', name: 'OTRO', isSystemAdmin: false };
    escenario.memberships = [{ organization: { slug: 'gr', name: 'Granma' }, roles: ['SUPER ADMIN'] }];
    r = await entrar();
    ok('SUPER ADMIN → rol admin', json(await get('/api/me', r.cookie)).user.rol === 'admin');

    console.log('\n5. Rol desconocido y persona sin sucursal');
    escenario.user = { id: 'u5', email: 'nuevo@procovar.cu', name: 'ROL NUEVO', isSystemAdmin: false };
    escenario.memberships = [{ organization: { slug: 'cam', name: 'Camagüey' }, roles: ['AUDITOR'] }];
    r = await entrar();
    me = json(await get('/api/me', r.cookie)).user;
    ok('rol que no está en la tabla → el de MENOS permisos', me.rol === 'usuario' && me.rol_accesos === null, `${me.rol}/${me.rol_accesos}`);
    ok('y no administra', (await get('/api/admin/users', r.cookie)).status === 403);

    escenario.user = { id: 'u6', email: 'sin@procovar.cu', name: 'SIN SUCURSAL', isSystemAdmin: false };
    escenario.memberships = [];
    r = await entrar();
    me = json(await get('/api/me', r.cookie)).user;
    ok('sin membresías: entra, pero sin sucursal y sin datos', me.sucursal === null && me.sinDatos === true, `${me.sucursal}/${me.sinDatos}`);
    ok('y no ve nada', json(await get('/api/activos', r.cookie)).total === 0);

    console.log('\n6. El returnTo (lo que se comprueba es lo que se usa)');
    escenario.memberships = [{ organization: { slug: 'cam', name: 'Camagüey' }, roles: ['SUPERVISOR'] }];
    r = await entrar('https://otro.com/robar');
    ok('un returnTo de otra parte va a /inicio', r.destino === `${APP}/inicio`, r.destino);
    r = await entrar('/responsables');
    ok('una ruta propia se respeta', r.destino === `${APP}/responsables`, r.destino);

    console.log('\n7. El código de un solo uso');
    const ida = await pedido({ url: `${APP}/api/auth/entrar` });
    const ident = await pedido({ url: ida.headers.location });
    const codigo = new URL(ident.headers.location).searchParams.get('code');
    const primera = await pedido({ url: ident.headers.location });
    ok('el primer canje funciona', /aft_sso=/.test(cookieDe(primera)), cookieDe(primera));
    const segunda = await pedido({ url: ident.headers.location });
    ok('recargar el callback lo gasta otra vez (?sso=error)', (segunda.headers.location || '').includes('sso=error'), segunda.headers.location);
    ok('sin código no sale del paso 0', (await get('/api/auth/sso/callback')).headers.location.includes('sso=sincodigo'));

    console.log('\n7b. Cerrar sesión (la cookie httpOnly la borra el servidor)');
    const saliendo = await post('/api/auth/logout', cam);
    ok('cierra la sesión', saliendo.status === 200 && json(saliendo).ok === true, saliendo.body);
    ok('y borra la cookie', (saliendo.headers['set-cookie'] || []).some((c) => /aft_sso=;/.test(c)), (saliendo.headers['set-cookie'] || []).join(' '));
    const sinSesion = await post('/api/auth/logout', null);
    ok('funciona también sin sesión (cookie caducada)', sinSesion.status === 200, String(sinSesion.status));

    console.log('\n8. El login local sigue ahí de respaldo');
    const admin = json(await post('/auth/login', null, { username: 'admin', password: 'admin123' }));
    ok('el admin local entra', !!admin.token);
    ok('y ve los 57', json(await get('/api/activos', null, admin.token)).total === 57);
    ok('y administra', (await get('/api/admin/users', null, admin.token)).status === 200);

    const creado = await post('/api/activos', cam, { descripcion: 'BICICLETA DE PRUEBA' });
    ok('una persona de Camagüey crea un activo en su sucursal', creado.status === 201, creado.body.slice(0, 120));
    ok('que es de Camagüey', json(creado).sucursal === 'Camagüey', json(creado).sucursal);
    ok('pero no puede borrar (sólo admin)', (await pedido({ url: `${APP}/api/activos/${json(creado).id}`, metodo: 'DELETE', cookie: cam })).status === 403);
    ok('no puede moverlo a otra sucursal', (await pedido({ url: `${APP}/api/activos/${json(creado).id}`, metodo: 'PUT', cookie: cam, cuerpo: { sucursal_id: 999 } })).status === 403);
    ok('y sí se borra desde admin', (await pedido({ url: `${APP}/api/activos/${json(creado).id}`, metodo: 'DELETE', auth: admin.token })).status === 200);

    const nuevo = await post('/api/admin/users', null, { username: 'local2', password: 'x1234567', nombre: 'Local Dos' }, admin.token);
    ok('crear usuario local', nuevo.status === 201, nuevo.body.slice(0, 120));
    ok('por defecto es de Camagüey', json(nuevo).sucursal === 'CAM', json(nuevo).sucursal);
    ok('sucursales que no son de las ocho no se aceptan', (await post('/api/admin/users', null, { username: 'local3', password: 'x1234567', sucursal: 'MADRID' }, admin.token)).status === 400);
    const local2 = json(await post('/auth/login', null, { username: 'local2', password: 'x1234567' }));
    ok('la cuenta local nueva ve los datos', json(await get('/api/activos', null, local2.token)).total === 57);

    console.log('\n8b. Entrada directa: correo y contraseña de Accesos, sin salir de la página');
    // Maria ya entró antes por el flujo de redirect. La identidad compartida es
    // el correo, así que ésta tiene que coger SU fila y no abrir otra.
    escenario.user = { id: 'u1', email: 'maria@procovar.cu', name: 'MARIA PEREZ', isSystemAdmin: false };
    escenario.memberships = [{ organization: { slug: 'cam', name: 'Camagüey' }, roles: ['SUPERVISOR'] }];
    escenario.email = 'maria@procovar.cu';
    escenario.password = 'secreto123';

    const directa = await post('/api/auth/login', null, { email: escenario.email, password: escenario.password });
    const creada = json(directa);
    ok('entra con el correo y la contraseña de Accesos', directa.status === 200 && !!creada.token, `${directa.status} ${directa.body.slice(0, 140)}`);
    ok('y emite la misma cookie httpOnly que el flujo de redirect', /aft_sso=[^;]+/.test(cookieDe(directa)), cookieDe(directa));
    ok('devuelve el usuario ya con sucursal y rol', creada.user && creada.user.sucursal === 'CAM' && creada.user.rol === 'usuario', JSON.stringify(creada.user || {}));
    ok('y el token sirve para seguir trabajando', json(await get('/api/activos', null, creada.token)).total === 57);

    const cdb = new Client({ host: PG.host, port: PG.port, user: PG.user, password: PG.password, database: bd });
    await cdb.connect();
    const { rows } = await cdb.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [escenario.email]);
    await cdb.end();
    ok('no abre una segunda fila: reutiliza la cuenta de la misma persona', rows[0].n === 1, `filas=${rows[0].n}`);

    const mala = await post('/api/auth/login', null, { email: escenario.email, password: 'no-es-esa' });
    ok('contraseña mala → 401 con el mismo mensaje para los dos casos', mala.status === 401 && json(mala).error === 'Correo o contraseña incorrectos', `${mala.status} ${mala.body}`);
    const sinCampos = await post('/api/auth/login', null, { email: escenario.email });
    ok('sin contraseña no se ni se llama a Accesos (400)', sinCampos.status === 400, String(sinCampos.status));

    console.log('\n9. Sin clave no se revienta: se cae al login de siempre');
    servidorSinClave = arrancar({ ...entorno, PORT: String(APP_PUERTO_SIN_CLAVE), AFT_AUTH_SIGNING_KEY: '' });
    await esperarSalud(APP_PUERTO_SIN_CLAVE);
    const sinClave = await pedido({ url: `http://127.0.0.1:${APP_PUERTO_SIN_CLAVE}/api/auth/entrar` });
    ok('redirige a ?sso=nodisponible', (sinClave.headers.location || '').includes('sso=nodisponible'), sinClave.headers.location);

    console.log(`\n${n - fallos}/${n} comprobaciones correctas${fallos ? `, ${fallos} FALLOS` : ''}.`);
    if (app && app.registro().includes('ERROR')) console.log('\nRegistro del servidor:\n' + app.registro());
  } catch (e) {
    fallos += 1;
    console.error('\nERROR:', e.message);
    if (app && app.registro()) console.error(app.registro());
  } finally {
    for (const h of [app, servidorSinClave]) { if (h) h.kill('SIGTERM'); }
    if (accesos) accesos.server.close();
    await borrarBase(bd).catch(() => {});
    process.exit(fallos ? 1 : 0);
  }
})();
