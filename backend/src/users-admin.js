const bcrypt = require('bcryptjs');
const db = require('./db');
const crypto = require('crypto');
const sso = require('./procovar-auth');
const alcance = require('./alcance');

const uuid = () => crypto.randomUUID();

async function listUsers(req, res, next) {
  try {
    const r = await db.getPool().query(
      'SELECT id, username, nombre, rol, activo, email, sucursal, rol_accesos, created_at FROM users ORDER BY created_at'
    );
    // La sucursal se calcula en un solo sitio (alcance.sucursalDe): una cuenta
    // local es de Camagüey aunque la columna venga vacía.
    return res.json(r.rows.map((u) => ({ ...u, sucursal: alcance.sucursalDe(u) })));
  } catch (e) { next(e); }
}

async function createUser(req, res, next) {
  try {
    const { username, password, nombre, rol, sucursal } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    // Sucursal de Accesos (CAM, GR, ...); por defecto Camagüey, que es lo que
    // este sistema gestiona. No confundir con el rol interno admin/usuario.
    const suc = (sucursal || alcance.SUCURSAL_LOCAL).trim().toUpperCase();
    if (!sso.esSucursalValida(suc)) {
      return res.status(400).json({ error: `Sucursal desconocida: ${sucursal}` });
    }
    const hash = await bcrypt.hash(password, 10);
    const r = await db.getPool().query(
      'INSERT INTO users (id, username, password_hash, nombre, rol, sucursal) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, nombre, rol, activo, sucursal, rol_accesos',
      [uuid(), username.trim(), hash, nombre || null, rol || 'usuario', suc]
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
    if (b.sucursal !== undefined) {
      const suc = String(b.sucursal || '').trim().toUpperCase();
      if (!sso.esSucursalValida(suc)) return res.status(400).json({ error: `Sucursal desconocida: ${b.sucursal}` });
      sets.push(`sucursal = ${p(suc)}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos a actualizar' });
    sets.push('updated_at = now()');
    params.push(req.params.id);
    if (req.params.id === req.user.id && b.activo === false) {
      return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
    }
    const r = await db.getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, username, nombre, rol, activo, sucursal, rol_accesos`, params);
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