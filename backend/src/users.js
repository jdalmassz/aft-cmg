const bcrypt = require('bcryptjs');
const db = require('./db');
const { sign } = require('./auth');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const r = await db.getPool().query('SELECT * FROM users WHERE username = $1', [username.trim()]);
  if (r.rowCount === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
  const user = r.rows[0];
  if (!user.activo) return res.status(403).json({ error: 'Usuario desactivado' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  return res.json({ token: sign(user), user: publicUser(user) });
}

function publicUser(u) {
  return { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, activo: u.activo };
}

async function me(req, res) {
  return res.json({ user: req.user });
}

async function ensureAdminUser() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const pool = db.getPool();
  const r = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (r.rowCount > 0) return;
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (id, username, password_hash, nombre, rol) VALUES ($1, $2, $3, $4, $5)',
    [uuid(), username, hash, 'Administrador', 'admin']
  );
  console.log(`Usuario admin por defecto creado: ${username}`);
}

module.exports = { login, me, ensureAdminUser };