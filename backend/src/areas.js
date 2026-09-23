const db = require('./db');

const { AREA_ETIQUETA } = require('./activos-query');

// Un área (Área 1, Área 2…) agrupa varias ubicaciones; cada ubicación pertenece a una sola.

const duplicado = (res, que) => res.status(400).json({ error: `Ya existe ${que} con ese nombre` });
const limpio = (v) => String(v || '').trim().toUpperCase();

async function listAreas(req, res, next) {
  try {
    const pool = db.getPool();
    const [areas, ubicaciones] = await Promise.all([
      pool.query(`SELECT ar.id, ar.numero, ar.nombre, ${AREA_ETIQUETA} AS etiqueta FROM areas ar ORDER BY ar.numero`),
      pool.query(`
        SELECT u.id, u.nombre, u.area_id, COUNT(a.id)::int AS activos
        FROM ubicaciones u LEFT JOIN activos a ON a.ubicacion_id = u.id
        GROUP BY u.id ORDER BY u.nombre`)
    ]);
    return res.json({ areas: areas.rows, ubicaciones: ubicaciones.rows });
  } catch (e) { next(e); }
}

function datosArea(body) {
  const numero = Number(body?.numero);
  if (!Number.isInteger(numero) || numero < 1) return { error: 'El número del área tiene que ser un entero mayor que 0' };
  return { numero, nombre: limpio(body?.nombre) || null };
}

async function createArea(req, res, next) {
  try {
    const d = datosArea(req.body);
    if (d.error) return res.status(400).json({ error: d.error });
    const r = await db.getPool().query('INSERT INTO areas (numero, nombre) VALUES ($1, $2) RETURNING id, numero, nombre', [d.numero, d.nombre]);
    return res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un área con ese número' });
    next(e);
  }
}

async function updateArea(req, res, next) {
  try {
    const d = datosArea(req.body);
    if (d.error) return res.status(400).json({ error: d.error });
    const r = await db.getPool().query('UPDATE areas SET numero = $1, nombre = $2 WHERE id = $3 RETURNING id, numero, nombre', [d.numero, d.nombre, req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Área no encontrada' });
    return res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un área con ese número' });
    next(e);
  }
}

async function deleteArea(req, res, next) {
  try {
    const u = await db.getPool().query('SELECT COUNT(*)::int AS n FROM ubicaciones WHERE area_id = $1', [req.params.id]);
    if (u.rows[0].n > 0) {
      return res.status(400).json({ error: `No se puede eliminar: tiene ${u.rows[0].n} ubicación(es). Muévelas a otra área primero` });
    }
    const r = await db.getPool().query('DELETE FROM areas WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Área no encontrada' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

async function createUbicacion(req, res, next) {
  try {
    const nombre = limpio(req.body?.nombre);
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'INSERT INTO ubicaciones (nombre, area_id) VALUES ($1, $2) RETURNING id, nombre, area_id',
      [nombre, req.body?.area_id || null]
    );
    return res.status(201).json({ ...r.rows[0], activos: 0 });
  } catch (e) {
    if (e.code === '23505') return duplicado(res, 'una ubicación');
    next(e);
  }
}

async function updateUbicacion(req, res, next) {
  try {
    const nombre = limpio(req.body?.nombre);
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'UPDATE ubicaciones SET nombre = $1, area_id = $2 WHERE id = $3 RETURNING id, nombre, area_id',
      [nombre, req.body?.area_id || null, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Ubicación no encontrada' });
    return res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return duplicado(res, 'una ubicación');
    next(e);
  }
}

async function deleteUbicacion(req, res, next) {
  try {
    const pool = db.getPool();
    const u = await pool.query('SELECT COUNT(*)::int AS n FROM activos WHERE ubicacion_id = $1', [req.params.id]);
    if (u.rows[0].n > 0) {
      return res.status(400).json({ error: `No se puede eliminar: tiene ${u.rows[0].n} activo(s)` });
    }
    const m = await pool.query(
      'SELECT COUNT(*)::int AS n FROM movimientos WHERE ubicacion_origen_id = $1 OR ubicacion_destino_id = $1',
      [req.params.id]
    );
    if (m.rows[0].n > 0) {
      return res.status(400).json({ error: 'No se puede eliminar: aparece en el historial de movimientos' });
    }
    const r = await pool.query('DELETE FROM ubicaciones WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Ubicación no encontrada' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listAreas, createArea, updateArea, deleteArea, createUbicacion, updateUbicacion, deleteUbicacion };
