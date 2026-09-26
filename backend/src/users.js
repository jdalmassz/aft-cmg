const bcrypt = require('bcryptjs');
const db = require('./db');
const { sign } = require('./auth');
const alcance = require('./alcance');
const sso = require('./procovar-auth');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

// ¿Tiene datos esta persona en este sistema? Su sucursal tiene que existir en
// la base; si no, entra pero no ve nada (se le avisa para que se note y se
// arregle). Quien ve las ocho siempre tiene datos.
async function sinDatosDe(pool, user) {
  if (alcance.veTodasLasSucursales(user)) return false;
  const nombre = sso.nombreSucursal(alcance.sucursalDe(user));
  if (!nombre) return true;
  const r = await pool.query('SELECT 1 FROM sucursales WHERE nombre = $1', [nombre]);
  return r.rowCount === 0;
}

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const r = await db.getPool().query('SELECT * FROM users WHERE username = $1', [username.trim()]);
  if (r.rowCount === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
  const user = r.rows[0];
  if (!user.activo) return res.status(403).json({ error: 'Usuario desactivado' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  return res.json({ token: sign(user), user: await publicUser(db.getPool(), user) });
}

async function publicUser(pool, u) {
  return {
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo,
    sucursal: alcance.sucursalDe(u),
    sucursalNombre: sso.nombreSucursal(alcance.sucursalDe(u)),
    rol_accesos: u.rol_accesos || null,
    sinDatos: await sinDatosDe(pool, u)
  };
}

async function me(req, res, next) {
  try {
    return res.json({ user: await publicUser(db.getPool(), req.user) });
  } catch (e) { next(e); }
}

async function ensureAdminUser() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const pool = db.getPool();
  const r = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (r.rowCount > 0) return;
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, nombre, rol, sucursal) VALUES ($1, $2, $3, $4, $5, $6)',
    [uuid(), username, hash, 'Administrador', 'admin', alcance.SUCURSAL_LOCAL]
  );
  console.log(`Usuario admin por defecto creado: ${username}`);
}

module.exports = { login, publicUser, me, ensureAdminUser, sinDatosDe };