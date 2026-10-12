const db = require('./db');
const ExcelJS = require('exceljs');

const { AREA_ETIQUETA } = require('./activos-query');

/*
 * Las ÁREAS de un responsable salen de sus activos: los fijos por su ubicación
 * y los útiles por la primera línea de `comentarios` («Área: ECONOMIA»), que es
 * donde vive el suyo (ver schema.sql y UtilesView.vue).
 */
async function areasPorCustodio(pool) {
  const { rows } = await pool.query(`
    SELECT custodio_id, numero, etiqueta FROM (
      SELECT a.custodio_id, ar.numero, ${AREA_ETIQUETA} AS etiqueta
      FROM activos a
      JOIN ubicaciones u ON u.id = a.ubicacion_id
      JOIN areas ar ON ar.id = u.area_id
      WHERE a.tipo = 'AFT' AND a.custodio_id IS NOT NULL
      UNION
      SELECT a.custodio_id, ar.numero, ${AREA_ETIQUETA} AS etiqueta
      FROM activos a
      JOIN areas ar ON split_part(a.comentarios, E'\\n', 1) = 'Área: ' || ar.nombre
      WHERE a.tipo = 'UTIL' AND a.custodio_id IS NOT NULL
    ) t ORDER BY numero`);
  const porCu = new Map();
  for (const r of rows) {
    if (!porCu.has(r.custodio_id)) porCu.set(r.custodio_id, []);
    porCu.get(r.custodio_id).push(r.etiqueta);
  }
  return porCu;
}

async function listCustodios(req, res, next) {
  try {
    const pool = db.getPool();
    const [r, areasDe] = await Promise.all([
      pool.query(`
      SELECT cu.id, cu.nombre, cu.user_id, us.username, COUNT(a.id)::int AS activos
      FROM custodios cu
      LEFT JOIN activos a ON a.custodio_id = cu.id
      LEFT JOIN users us ON us.id = cu.user_id
      GROUP BY cu.id, cu.nombre, us.username
      ORDER BY cu.nombre`),
      areasPorCustodio(pool)
    ]);
    return res.json(r.rows.map((c) => ({ ...c, areas: areasDe.get(c.id) || [] })));
  } catch (e) { next(e); }
}

async function createCustodio(req, res, next) {
  try {
    const nombre = (req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'INSERT INTO custodios (nombre, user_id) VALUES ($1, $2) RETURNING id, nombre, user_id',
      [nombre, req.body?.user_id || null]
    );
    return res.status(201).json({ ...r.rows[0], activos: 0 });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: e.constraint?.includes('user_id') ? 'Ese usuario ya está vinculado a otro responsable' : 'Ya existe un responsable con ese nombre' });
    next(e);
  }
}

async function updateCustodio(req, res, next) {
  try {
    const nombre = (req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'UPDATE custodios SET nombre = $1, user_id = $2 WHERE id = $3 RETURNING id, nombre, user_id',
      [nombre, req.body?.user_id || null, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Responsable no encontrado' });
    return res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: e.constraint?.includes('user_id') ? 'Ese usuario ya está vinculado a otro responsable' : 'Ya existe un responsable con ese nombre' });
    next(e);
  }
}

async function deleteCustodio(req, res, next) {
  try {
    const u = await db.getPool().query(
      'SELECT COUNT(*)::int AS n FROM activos WHERE custodio_id = $1',
      [req.params.id]
    );
    if (u.rows[0].n > 0) {
      return res.status(400).json({ error: `No se puede eliminar: tiene ${u.rows[0].n} activo(s) asignados` });
    }
    const r = await db.getPool().query('DELETE FROM custodios WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Responsable no encontrado' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

/**
 * Excel «Responsables y áreas»: una fila por responsable con sus áreas (las
 * etiquetas, «Área 5 - FACTURACION») y su conteo de activos. Mismo formato que
 * el Excel de áreas (TableStyleLight13, Aptos Narrow).
 */
const FONT = { name: 'Aptos Narrow', size: 11, family: 2, scheme: 'minor' };

async function exportCustodiosXlsx(req, res, next) {
  try {
    const pool = db.getPool();
    const [r, areasDe] = await Promise.all([
      pool.query(`
        SELECT cu.id, cu.nombre, COUNT(a.id)::int AS activos
        FROM custodios cu
        LEFT JOIN activos a ON a.custodio_id = cu.id
        GROUP BY cu.id, cu.nombre
        ORDER BY cu.nombre`),
      areasPorCustodio(pool)
    ]);
    const filas = r.rows.map((c) => [c.nombre, (areasDe.get(c.id) || []).join(', '), c.activos]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Responsables', {
      views: [{ showGridLines: false, zoomScale: 110, zoomScaleNormal: 110 }]
    });
    const columnas = [
      { header: 'Responsable', width: 40 },
      { header: 'Áreas', width: 55 },
      { header: 'Activos', width: 10 }
    ];
    columnas.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

    if (filas.length) {
      ws.addTable({
        name: 'TablaResponsables',
        ref: 'A1',
        headerRow: true,
        style: { theme: 'TableStyleLight13', showRowStripes: true },
        columns: columnas.map((c) => ({ name: c.header, filterButton: true })),
        rows: filas
      });
    } else {
      ws.getRow(1).values = columnas.map((c) => c.header);
    }

    ws.getRow(1).eachCell((cell) => {
      cell.font = { ...FONT, bold: true };
      cell.alignment = { horizontal: 'center' };
    });
    for (let rw = 2; rw <= filas.length + 1; rw++) {
      ws.getRow(rw).eachCell((cell) => { cell.font = { ...FONT }; });
    }

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Responsables y areas-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

module.exports = { listCustodios, createCustodio, updateCustodio, deleteCustodio, exportCustodiosXlsx };
