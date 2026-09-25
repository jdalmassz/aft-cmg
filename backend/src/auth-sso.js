// Endpoints de Accesos (SSO): entrar, callback, logout.
// Caminos de delivery: src/app/api/auth/ (entrar, callback, logout, logout/done).
// Todo lo aquí sale de leer ese código, no de la documentación.

const db = require('./db');
const { sign } = require('./auth');
const sso = require('./procovar-auth');

function cookieOpts(req) {
  // Secure solo cuando viene por https; en local (http) se rompería.
  const secure = req.protocol === 'https';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 12 * 60 * 60 * 1000,
    path: '/'
  };
}

async function fetchAuth(path, body) {
  const bodyStr = JSON.stringify(body || {});
  const headers = sso.headersFirma('POST', path, bodyStr);
  const res = await fetch(`${sso.AUTH_URL}${path}`, {
    method: 'POST',
    headers,
    body: bodyStr,
    // Si Accesos no contesta, que no se quede colgada la entrada de nadie.
    signal: AbortSignal.timeout(10000)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Accesos ${res.status}`);
    err.status = res.status;
    err.code = data.code || 'sso_error';
    throw err;
  }
  return data;
}

async function upsertUser(pool, accUser, rolInterno, sucursal, rolAccesos) {
  // La cuenta local se crea o se actualiza en cada entrada, y NO se borra.
  // No es un duplicado de la de Accesos: es la fila a la que apuntan los
  // activos y los movimientos que esa persona ha creado. Si se borrara y se
  // volviera a crear, su trabajo se quedaría huérfano. La identidad compartida
  // es el correo.
  const email = accUser.email;
  let existing = null;
  if (email) {
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    existing = r.rows[0];
  }

  // La contraseña local se deja como estaba. Ya no se usa para entrar, pero
  // borrarla impediría volver al login de siempre si hubiera que dar marcha
  // atrás. Para las cuentas nuevas, guardamos una cadena que no es un hash
  // válido, así que ninguna comparación acierta nunca.
  const placeholderHash = 'sso:procovar:' + (email || accUser.id);

  if (existing) {
    const r = await pool.query(
      `UPDATE users SET nombre = $1, rol = $2, email = $3, sucursal = $4, rol_accesos = $5,
       activo = true, updated_at = now() WHERE id = $6
       RETURNING id, username, nombre, rol, activo, email, sucursal, rol_accesos`,
      [accUser.name || existing.nombre, rolInterno, email, sucursal, rolAccesos, existing.id]
    );
    return r.rows[0];
  }
  const crypto = require('crypto');
  const r = await pool.query(
    `INSERT INTO users (id, username, password_hash, nombre, rol, email, sucursal, rol_accesos, activo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id, username, nombre, rol, activo, email, sucursal, rol_accesos`,
    [crypto.randomUUID(), email || accUser.id, placeholderHash, accUser.name || email, rolInterno, email, sucursal, rolAccesos]
  );
  return r.rows[0];
}

// 1. Pedir la ida a Accesos.
async function entrar(req, res) {
  if (!sso.loginUnicoDisponible()) {
    return res.redirect(`/?sso=nodisponible`);
  }
  try {
    const callbackUrl = `${sso.origenPublico(req)}/api/auth/sso/callback`;
    const returnTo = sso.safeReturnTo(req);
    const data = await fetchAuth('/api/auth/callback-token', {
      clientId: sso.CLIENT_ID,
      callbackUrl,
      returnTo
    });
    if (!data.redirectUrl) throw new Error('Accesos no devolvió redirectUrl');
    return res.redirect(data.redirectUrl);
  } catch (e) {
    console.error('SSO entrar:', e.status || 500, e.code || '', e.message);
    return res.redirect(`/?sso=error`);
  }
}

// 2. Volver de Accesos con ?code= y canjearlo.
async function callback(req, res) {
  const code = req.query.code;
  if (!code) return res.redirect(`/?sso=sincodigo`);
  try {
    const data = await fetchAuth('/api/auth/exchange', { code });
    const { user, memberships, returnTo } = data;

    // El returnTo ha ido y vuelto por Accesos: validarlo de nuevo,
    // porque "lo que se comprueba es lo que se usa".
    const destino = sso.destinoSeguro(returnTo, req) ? returnTo : `${sso.origenPublico(req)}/inicio`;

    // Accesos devuelve las membresías de la más reciente a la más antigua y
    // nos quedamos con la primera: sucursal y rol salen de esa misma.
    const membresia = Array.isArray(memberships) && memberships.length ? memberships[0] : null;
    const roles = (membresia && membresia.roles) || [];
    const rolAccesos = sso.normalizaRol(roles[0]);
    const sucursal = sso.sucursalDesdeMemberships(memberships);
    const rol = sso.rolInterno(rolAccesos);

    // Un solo INSERT o UPDATE: no hace falta transacción (y con pool hay que
    // evitar BEGIN/COMMIT sobre clientes distintos).
    const localUser = await upsertUser(db.getPool(), user, rol, sucursal, rolAccesos);

    // Registro de la entrada: quién, con qué rol de Accesos y a qué sucursal
    // queda asignado. El motivo de un fallo va aquí, no a la pantalla.
    console.log(
      `SSO entrada: ${user.email || user.id} · rol_accesos=${rolAccesos || 'desconocido'} · ` +
      `rol=${rol} · sucursal=${sucursal || 'ninguna'}`
    );

    const token = sign(localUser);
    res.cookie(sso.SSO_COOKIE, token, cookieOpts(req));
    return res.redirect(destino);
  } catch (e) {
    // El motivo entero va al registro (a quien entra no le sirve de nada y a
    // quien lo arregla le hace falta); en la URL sólo un código para poder
    // distinguirlos.
    console.error('SSO callback:', e.status || 500, e.code || '', e.message);
    if (e.code === '23505') {
      console.error('SSO callback: ya existe una cuenta local con ese username o correo; hay que unificarla a mano.');
    }
    return res.redirect(`/?sso=error`);
  }
}

module.exports = { entrar, callback };