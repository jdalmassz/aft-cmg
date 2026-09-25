const db = require('./db');
const alcance = require('./alcance');

const MOV_COLUMNS = `
  m.id, m.tipo, m.ubicacion_origen_id, m.ubicacion_destino_id,
  m.custodio_origen_id, m.custodio_destino_id, m.estado_origen, m.estado_destino,
  m.comentario, m.usuario_id, m.created_at,
  uo.nombre AS ubicacion_origen, ud.nombre AS ubicacion_destino,
  co.nombre AS custodio_origen, cd.nombre AS custodio_destino,
  a.id AS activo_id, a.codigo AS activo_codigo, a.descripcion AS activo_descripcion`;

const MOV_FROM = `
  FROM movimientos m
  JOIN activos a ON a.id = m.activo_id
  LEFT JOIN ubicaciones uo ON uo.id = m.ubicacion_origen_id
  LEFT JOIN ubicaciones ud ON ud.id = m.ubicacion_destino_id
  LEFT JOIN custodios co ON co.id = m.custodio_origen_id
  LEFT JOIN custodios cd ON cd.id = m.custodio_destino_id`;

async function registerMovimiento(pool, mov) {
  const { activo_id, tipo, ubicacion_origen_id = null, ubicacion_destino_id = null,
          custodio_origen_id = null, custodio_destino_id = null,
          estado_origen = null, estado_destino = null, comentario = null, usuario_id = null } = mov;
  await pool.query(
    `INSERT INTO movimientos (activo_id, tipo, ubicacion_origen_id, ubicacion_destino_id,
       custodio_origen_id, custodio_destino_id, estado_origen, estado_destino, comentario, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [activo_id, tipo, ubicacion_origen_id, ubicacion_destino_id,
     custodio_origen_id, custodio_destino_id, estado_origen, estado_destino, comentario, usuario_id]
  );
}

async function movimientosByActivo(req, res, next) {
  try {
    const params = [req.params.id];
    // El historial sigue al activo: si el activo es de otra sucursal, tampoco
    // se ve su historial (404 de fondo, no un 403 que delataría que existe).
    const cond = alcance.condicionSucursal(req.user, (v) => { params.push(v); return `$${params.length}`; });
    const r = await db.getPool().query(
      `SELECT ${MOV_COLUMNS} ${MOV_FROM} WHERE m.activo_id = $1${cond ? ` AND ${cond}` : ''} ORDER BY m.created_at DESC, m.id DESC LIMIT 500`,
      params
    );
    return res.json({ movimientos: r.rows });
  } catch (e) { next(e); }
}

async function listMovimientos(req, res, next) {
  try {
    const { activo_id, q, limit = 500 } = req.query;
    const where = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (activo_id) where.push(`m.activo_id = ${p(activo_id)}`);
    if (q) where.push(`(a.descripcion ILIKE ${p('%' + q + '%')} OR a.codigo ILIKE ${p('%' + q + '%')})`);
    const cond = alcance.condicionSucursal(req.user, p);
    if (cond) where.push(cond);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await db.getPool().query(
      `SELECT ${MOV_COLUMNS} ${MOV_FROM} ${whereSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ${p(limit)}`,
      params
    );
    return res.json({ movimientos: r.rows });
  } catch (e) { next(e); }
}

module.exports = { registerMovimiento, movimientosByActivo, listMovimientos };