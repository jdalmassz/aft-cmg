const db = require('./db');
const ExcelJS = require('exceljs');
const { registerMovimiento } = require('./movimientos');

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

function buildWhere({ q, categoria, ubicacion, custodio, marca, estado }) {
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

  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params, p };
}

async function listActivos(req, res, next) {
  try {
    const { q, categoria, ubicacion, custodio, marca, estado, limite = 200, offset = 0 } = req.query;
    const from = buildWhere({ q, categoria, ubicacion, custodio, marca, estado });
    const total = await db.getPool().query(`SELECT COUNT(*)::int AS n ${ACTIVOS_FROM} ${from.sql}`, from.params);
    const rows = await db.getPool().query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql} ORDER BY a.id DESC LIMIT ${from.p(limite)} OFFSET ${from.p(offset)}`,
      from.params
    );
    return res.json({ total: total.rows[0].n, activos: rows.rows });
  } catch (e) { next(e); }
}

async function exportActivos(req, res, next) {
  try {
    const { q, categoria, ubicacion, custodio, marca, estado } = req.query;
    const from = buildWhere({ q, categoria, ubicacion, custodio, marca, estado });
    const rows = await db.getPool().query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql} ORDER BY a.id`,
      from.params
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventario AFT');
    ws.columns = [
      { header: 'Código', key: 'codigo', width: 12 },
      { header: 'Descripción', key: 'descripcion', width: 42 },
      { header: 'Marca', key: 'marca', width: 16 },
      { header: 'Modelo', key: 'modelo', width: 18 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Ubicación', key: 'ubicacion', width: 18 },
      { header: 'Custodio', key: 'custodio', width: 22 },
      { header: 'Valor CUP', key: 'valor_cup', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Valor USD', key: 'valor_usd', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Estado', key: 'estado', width: 9 },
      { header: 'Fecha Adquisición', key: 'fecha_adquisicion', width: 14 },
      { header: 'Comentarios', key: 'comentarios', width: 32 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2458A6' } };
    ws.getRow(1).alignment = { vertical: 'middle' };
    ws.getRow(1).height = 20;

    for (const a of rows.rows) {
      ws.addRow({
        codigo: a.codigo || '', descripcion: a.descripcion,
        marca: a.marca || '', modelo: a.modelo || '',
        categoria: a.categoria || '', ubicacion: a.ubicacion || '',
        custodio: a.custodio || '',
        valor_cup: a.valor_cup == null ? null : Number(a.valor_cup),
        valor_usd: a.valor_usd == null ? null : Number(a.valor_usd),
        estado: a.estado || '', fecha_adquisicion: a.fecha_adquisicion || '',
        comentarios: a.comentarios || ''
      });
    }
    if (rows.rows.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    }

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="AFT-Camaguey-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
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
    await registerMovimiento(db.getPool(), {
      activo_id: r.rows[0].id,
      tipo: 'CREADO',
      ubicacion_destino_id: b.ubicacion_id || null,
      custodio_destino_id: b.custodio_id || null,
      estado_destino: b.estado || 'ACTIVO',
      usuario_id: req.user?.id || null
    });
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

    const prev = await db.getPool().query('SELECT id, ubicacion_id, custodio_id, estado FROM activos WHERE id = $1', [req.params.id]);
    if (prev.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });

    const upd = await db.getPool().query(`UPDATE activos SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (upd.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });

    const old = prev.rows[0];
    const novo = {
      ubicacion_id: b.ubicacion_id ?? old.ubicacion_id,
      custodio_id: b.custodio_id ?? old.custodio_id,
      estado: b.estado ?? old.estado
    };
    const base = { activo_id: old.id, usuario_id: req.user?.id || null, comentario: b.comentarios ?? null };
    if (Object.prototype.hasOwnProperty.call(b, 'ubicacion_id') && Number(novo.ubicacion_id || 0) !== Number(old.ubicacion_id || 0)) {
      await registerMovimiento(db.getPool(), { ...base, tipo: 'TRASLADO_UBICACION', ubicacion_origen_id: old.ubicacion_id, ubicacion_destino_id: novo.ubicacion_id });
    }
    if (Object.prototype.hasOwnProperty.call(b, 'custodio_id') && Number(novo.custodio_id || 0) !== Number(old.custodio_id || 0)) {
      await registerMovimiento(db.getPool(), { ...base, tipo: 'CAMBIO_CUSTODIO', custodio_origen_id: old.custodio_id, custodio_destino_id: novo.custodio_id });
    }
    if (Object.prototype.hasOwnProperty.call(b, 'estado') && novo.estado !== old.estado) {
      await registerMovimiento(db.getPool(), { ...base, tipo: 'CAMBIAR_ESTADO', estado_origen: old.estado, estado_destino: novo.estado });
    }

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

module.exports = { listActivos, getActivo, createActivo, updateActivo, deleteActivo, catalogo, dashboard, exportActivos };