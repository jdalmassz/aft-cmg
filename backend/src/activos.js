const db = require('./db');

const ACTIVOS_COLUMNS = `
  a.id, a.codigo, a.descripcion, a.modelo, a.valor_cup, a.valor_usd,
  a.fecha_adquisicion, a.estado, a.comentarios, a.created_at, a.updated_at,
  a.categoria_id, c.nombre AS categoria,
  a.sucursal_id, s.nombre AS sucursal,
  a.ubicacion_id, u.nombre AS ubicacion,
  a.custodio_id, cu.nombre AS custodio,
  a.marca_id, m.nombre AS marca`;

const ACTIVOS_FROM = `
  FROM activos a
  LEFT JOIN categorias c ON c.id = a.categoria_id
  LEFT JOIN sucursales s ON s.id = a.sucursal_id
  LEFT JOIN ubicaciones u ON u.id = a.ubicacion_id
  LEFT JOIN custodios cu ON cu.id = a.custodio_id
  LEFT JOIN marcas m ON m.id = a.marca_id`;

async function listActivos(req, res, next) {
  try {
    const { q, categoria, ubicacion, custodio, marca, estado, limite = 200, offset = 0 } = req.query;
    const where = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    if (q) {
      where.push(`(a.descripcion ILIKE ${p('%' + q + '%')} OR a.modelo ILIKE ${p('%' + q + '%')} OR a.codigo ILIKE ${p('%' + q + '%')})`);
    }
    if (categoria) where.push(`a.categoria_id = ${p(categoria)}`);
    if (ubicacion) where.push(`a.ubicacion_id = ${p(ubicacion)}`);
    if (custodio) where.push(`a.custodio_id = ${p(custodio)}`);
    if (marca) where.push(`a.marca_id = ${p(marca)}`);
    if (estado) where.push(`a.estado = ${p(estado)}`);

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = await db.getPool().query(`SELECT COUNT(*)::int AS n ${ACTIVOS_FROM} ${whereSql}`, params);
    const rows = await db.getPool().query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${whereSql} ORDER BY a.id DESC LIMIT ${p(limite)} OFFSET ${p(offset)}`,
      params
    );
    return res.json({ total: total.rows[0].n, activos: rows.rows });
  } catch (e) { next(e); }
}

async function getActivo(req, res, next) {
  try {
    const r = await db.getPool().query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.id = $1`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    return res.json(r.rows[0]);
  } catch (e) { next(e); }
}

async function createActivo(req, res, next) {
  try {
    const b = req.body;
    const needed = ['descripcion'];
    for (const f of needed) {
      if (!b[f]) return res.status(400).json({ error: `Campo requerido: ${f}` });
    }
    const keys = ['codigo', 'descripcion', 'marca_id', 'modelo', 'valor_cup', 'valor_usd', 'categoria_id', 'sucursal_id', 'fecha_adquisicion', 'ubicacion_id', 'custodio_id', 'estado', 'comentarios'];
    const values = keys.map((k) => b[k] ?? (k === 'estado' ? 'ACTIVO' : null));
    const r = await db.getPool().query(
      `INSERT INTO activos (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      values
    );
    const row = await db.getPool().query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.id = $1`, [r.rows[0].id]);
    return res.status(201).json(row.rows[0]);
  } catch (e) { next(e); }
}

async function updateActivo(req, res, next) {
  try {
    const b = req.body;
    const allowed = ['codigo', 'descripcion', 'marca_id', 'modelo', 'valor_cup', 'valor_usd', 'categoria_id', 'sucursal_id', 'fecha_adquisicion', 'ubicacion_id', 'custodio_id', 'estado', 'comentarios'];
    const sets = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    for (const k of allowed) {
      if (k in b) { sets.push(`${k} = ${p(b[k])}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos a actualizar' });
    sets.push(`updated_at = now()`);
    params.push(req.params.id);
    const upd = await db.getPool().query(`UPDATE activos SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (upd.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    const r = await db.getPool().query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.id = $1`, [req.params.id]);
    return res.json(r.rows[0]);
  } catch (e) { next(e); }
}

async function deleteActivo(req, res, next) {
  try {
    const r = await db.getPool().query('DELETE FROM activos WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

async function catalogo(req, res, next) {
  try {
    const [categorias, sucursales, ubicaciones, custodios, marcas] = await Promise.all([
      db.getPool().query('SELECT id, nombre, ejemplos FROM categorias ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM sucursales ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM ubicaciones ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM custodios ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM marcas ORDER BY nombre')
    ]);
    return res.json({
      categorias: categorias.rows,
      sucursales: sucursales.rows,
      ubicaciones: ubicaciones.rows,
      custodios: custodios.rows,
      marcas: marcas.rows
    });
  } catch (e) { next(e); }
}

async function dashboard(req, res, next) {
  try {
    const dbp = db.getPool();
    const [total, porCategoria, porUbicacion, porEstado, valores, recientes, custodiosTop] = await Promise.all([
      dbp.query('SELECT COUNT(*)::int AS total FROM activos'),
      dbp.query(`
        SELECT c.nombre, COUNT(a.id)::int AS cantidad
        FROM categorias c LEFT JOIN activos a ON a.categoria_id = c.id
        GROUP BY c.id, c.nombre ORDER BY cantidad DESC`),
      dbp.query(`
        SELECT u.nombre, COUNT(a.id)::int AS cantidad
        FROM ubicaciones u LEFT JOIN activos a ON a.ubicacion_id = u.id AND a.estado = 'ACTIVO'
        GROUP BY u.id, u.nombre ORDER BY u.nombre`),
      dbp.query('SELECT estado, COUNT(*)::int AS cantidad FROM activos GROUP BY estado'),
      dbp.query('SELECT COALESCE(SUM(valor_usd),0)::numeric AS valor_usd, COALESCE(SUM(valor_cup),0)::numeric AS valor_cup FROM activos WHERE estado = $1', ['ACTIVO']),
      dbp.query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ORDER BY a.created_at DESC LIMIT 5`),
      dbp.query(`
        SELECT cu.nombre, COUNT(a.id)::int AS cantidad
        FROM custodios cu JOIN activos a ON a.custodio_id = cu.id
        GROUP BY cu.id, cu.nombre ORDER BY cantidad DESC LIMIT 10`)
    ]);
    return res.json({
      total: total.rows[0].total,
      porCategoria: porCategoria.rows,
      porUbicacion: porUbicacion.rows,
      porEstado: porEstado.rows,
      valores: valores.rows[0],
      recientes: recientes.rows,
      custodiosTop: custodiosTop.rows
    });
  } catch (e) { next(e); }
}

module.exports = { listActivos, getActivo, createActivo, updateActivo, deleteActivo, catalogo, dashboard };