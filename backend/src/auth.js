const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'cambia-este-secreto';
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';

function sign(user) {
  return jwt.sign({ uid: user.id, username: user.username, rol: user.rol }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // El callback SSO guarda el token en cookie httpOnly; el navegador la envía
  // automáticamente. Sin esto, las peticiones tras el login no llegaban
  // autenticadas (delivery ya sabía leer esa cookie — era el camino de respaldo
  // que nadie usaba).
  if (!token) token = req.cookies && req.cookies.aft_sso;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const r = await db.getPool().query('SELECT id, username, nombre, rol, activo, email, sucursal, rol_accesos FROM users WHERE id = $1', [payload.uid]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'Usuario no existe' });
    if (!r.rows[0].activo) return res.status(403).json({ error: 'Usuario desactivado' });
    req.user = r.rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

function adminOnly(req, res, next) {
  if (req.user && req.user.rol === 'admin') return next();
  return res.status(403).json({ error: 'Requiere rol administrador' });
}

module.exports = { sign, authMiddleware, adminOnly };