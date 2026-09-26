// Entrada con el correo y la contraseña de Accesos, dentro de NUESTRA pantalla:
// la persona no se sale de la página para identificarse.
//
// Accesos expone dos puertas para esto: POST /api/auth/token (sin firma, sólo
// correo y contraseña) y POST /api/auth/verify (firmada, devuelve a la persona
// con sus sucursales). A partir de ahí el resto del camino es el MISMO que en
// el callback SSO: traducción de roles y sucursales en procovar-auth.js, la
// cuenta local que se crea o se actualiza en cada entrada, y nuestro propio
// token. Cambiar la puerta de entrada sin tocar las cerraduras de dentro es lo
// que hizo que el SSO saliera bien.
//
// ATENCIÓN: esto hace que la contraseña pase por nuestro servidor, que es
// exactamente lo que el flujo de redirect (entrar + callback) evita a propósito.
// Está escrito así porque se pidió entrar sin salir de la página; si Jose lo
// desaprueba, se vuelve al botón de /api/auth/entrar, que sigue montado.

const db = require('./db');
const { sign } = require('./auth');
const sso = require('./procovar-auth');
const users = require('./users');
const { fetchAuth, upsertUser, cookieOpts, datosDeEntrada } = require('./auth-sso');

// Nombres por los que Accesos puede traer a la persona y a sus sucursales.
// No están documentados en la guía de la casa (ésta describe el flujo de
// redirect), así que se mira el cuerpo en orden y se pasa de largo de lo que no
// se conoce: un nombre que cambie no puede dejar a la gente fuera de la
// aplicación. Si algo no encaja, la respuesta entera va al registro.
const CAMPOS_USUARIO = ['user', 'usuario', 'profile', 'account'];
const CAMPOS_MEMBRESIAS = ['memberships', 'membresias', 'organizations', 'orgs'];
const CAMPOS_TOKEN = ['access_token', 'accessToken', 'token', 'session_token', 'sessionToken', 'id_token', 'session'];

function traer(data, nombres) {
  // A veces viene dentro de { data: {...} }; se miran las dos capas.
  const fuentes = [data, data && data.data];
  for (const fuente of fuentes) {
    if (!fuente || typeof fuente !== 'object') continue;
    for (const n of nombres) {
      if (fuente[n] !== undefined && fuente[n] !== null) return fuente[n];
    }
  }
  return undefined;
}

async function pedirToken(body, firmada) {
  return fetchAuth('/api/auth/token', body, { firmada });
}

// /api/auth/verify: hace falta la firma, y el nombre del campo que lleva el
// token no lo tenemos escrito. Se prueban los tres posibles y se insiste sólo
// mientras el fallo sea "el cuerpo no es el que espero" (400): con un token
// bueno y un campo malo el servicio no puede decir otra cosa, y un 401 con el
// campo correcto ya no se reintenta.
async function verificar(tokenDeAccesos) {
  const cuerpos = [{ token: tokenDeAccesos }, { access_token: tokenDeAccesos }, { sessionId: tokenDeAccesos }];
  let ultimo = null;
  for (const cuerpo of cuerpos) {
    try {
      return await fetchAuth('/api/auth/verify', cuerpo, { firmada: true });
    } catch (e) {
      ultimo = e;
      if (e.status !== 400) break;
    }
  }
  console.error('Accesos /verify:', ultimo.status || 500, ultimo.code || '', ultimo.message);
  return null;
}

// Aviso de seguridad: esta ruta es, por dentro, un comprobador de contraseñas
// contra Accesos. Sin límite, alguien pasaría la tarde probando cuentas desde
// aquí en vez de desde su pantalla. Se cuentan SÓLO los fallos, por IP, y se
// olvidan al cabo de la ventana: entrar bien siempre es gratis.
const FALLOS = new Map(); // ip -> { n, desde }
const MAX_FALLOS = 10;
const VENTANA = 15 * 60 * 1000;

function recortar(ahora) {
  if (FALLOS.size < 500) return;
  for (const [ip, e] of FALLOS) if (ahora - e.desde > VENTANA) FALLOS.delete(ip);
}

function limitado(ip, ahora) {
  const e = FALLOS.get(ip);
  if (!e || ahora - e.desde > VENTANA) { FALLOS.delete(ip); return false; }
  return e.n >= MAX_FALLOS;
}

function anotarFallo(ip, ahora) {
  recortar(ahora);
  const e = FALLOS.get(ip);
  if (!e || ahora - e.desde > VENTANA) FALLOS.set(ip, { n: 1, desde: ahora });
  else e.n += 1;
}

async function loginAccesos(req, res) {
  const b = req.body || {};
  const email = String(b.email || b.username || '').trim();
  const password = b.password;
  if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña requeridos' });

  const ahora = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'desconocida';
  if (limitado(ip, ahora)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos; vuelve a intentarlo en unos minutos' });
  }

  let data;
  try {
    data = await pedirToken({ email, password }, false);
  } catch (e) {
    // Sin credenciales no se puede distinguir "no existe" de "no es esa la
    // contraseña", y decirlo sería un detalle para adivinar cuentas.
    if (e.status === 401 && !/missing_headers|service-auth/.test(String(e.message))) {
      anotarFallo(ip, ahora);
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    // Si un día pasa a exigir firma, se reintenta firmado antes de rendirse.
    try {
      data = await pedirToken({ email, password }, true);
    } catch (e2) {
      console.error('Accesos /token:', e2.status || 500, e2.code || '', e2.message);
      anotarFallo(ip, ahora);
      // Un fallo de la red o de Accesos no es culpa de quien entra.
      return e2.status >= 400 && e2.status < 500
        ? res.status(502).json({ error: 'No se pudo completar la entrada con Accesos' })
        : res.status(502).json({ error: 'Accesos no está disponible; inténtalo de nuevo en unos minutos' });
    }
  }

  let user = traer(data, CAMPOS_USUARIO);
  let memberships = traer(data, CAMPOS_MEMBRESIAS);

  if (!user) {
    const t = traer(data, CAMPOS_TOKEN);
    if (t) {
      const v = await verificar(t);
      if (v) {
        user = traer(v, CAMPOS_USUARIO);
        memberships = traer(v, CAMPOS_MEMBRESIAS) || memberships;
      }
    }
  }

  if (!user) {
    // El motivo entero va al registro: sin esto, un nombre de campo que cambie
    // se ve en pantalla como "correo o contraseña incorrectos" y cuesta una
    // tarde saber que las credenciales estaban bien.
    console.error('Accesos /token: respuesta sin persona', JSON.stringify(data));
    return res.status(502).json({ error: 'No se pudo completar la entrada con Accesos' });
  }

  try {
    const { rolAccesos, sucursal, rol } = datosDeEntrada(user, memberships);
    const local = await upsertUser(db.getPool(), user, rol, sucursal, rolAccesos);
    console.log(
      `Accesos entrada directa: ${user.email || user.id} · rol_accesos=${rolAccesos || 'desconocido'} · ` +
      `rol=${rol} · sucursal=${sucursal || 'ninguna'}`
    );
    const jwt = sign(local);
    res.cookie(sso.SSO_COOKIE, jwt, cookieOpts(req));
    return res.json({ token: jwt, user: await users.publicUser(db.getPool(), local) });
  } catch (e) {
    console.error('Accesos entrada directa:', e.message);
    return res.status(500).json({ error: e.message || 'Error interno' });
  }
}

module.exports = { loginAccesos };
