const bcrypt = require('bcryptjs');
const db = require('./db');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

async function listUsers(req, res, next) {
  try {
    const r = await db.getPool().query('SELECT id, username, nombre, rol, activo, created_at FROM users ORDER BY created_at');
    return res.json(r.rows);
  } catch (e) { next(e); }
}

async function createUser(req, res, next) {
  try {
    const { username, password, nombre, rol } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const hash = await bcrypt.hash(password, 10);
    const r = await db.getPool().query(
      'INSERT INTO users (id, username, password_hash, nombre, rol) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, nombre, rol, activo',
      [uuid(), username.trim(), hash, nombre || null, rol || 'usuario']
    );
    return res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'El usuario ya existe' });
    next(e);
  }
}

async function updateUser(req, res, next) {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (b.nombre !== undefined) { sets.push(`nombre = ${p(b.nombre)}`); }
    if (b.rol !== undefined) { sets.push(`rol = ${p(b.rol)}`); }
    if (b.activo !== undefined) { sets.push(`activo = ${p(Boolean(b.activo))}`); }
    if (b.password) {
      sets.push(`password_hash = ${p(await bcrypt.hash(b.password, 10))}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos a actualizar' });
    sets.push('updated_at = now()');
    params.push(req.params.id);
    if (req.params.id === req.user.id && b.activo === false) {
      return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
    }
    const r = await db.getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, username, nombre, rol, activo`, params);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json(r.rows[0]);
  } catch (e) { next(e); }
}

async function changePassword(req, res, next) {
  try {
    const { current, nuevo } = req.body || {};
    if (!current || !nuevo) return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
    const r = await db.getPool().query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current, r.rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    await db.getPool().query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [await bcrypt.hash(nuevo, 10), req.user.id]);
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listUsers, createUser, updateUser, changePassword };