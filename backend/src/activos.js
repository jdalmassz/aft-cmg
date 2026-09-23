const db = require('./db');
const ExcelJS = require('exceljs');
const { registerMovimiento } = require('./movimientos');
const { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere } = require('./activos-query');

async function listActivos(req, res, next) {
  try {
    const { q, categoria, area, ubicacion, custodio, marca, estado, limite = 200, offset = 0 } = req.query;
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado });
    const total = await db.getPool().query(`SELECT COUNT(*)::int AS n ${ACTIVOS_FROM} ${from.sql}`, from.params);
    const rows = await db.getPool().query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql} ORDER BY a.id DESC LIMIT ${from.p(limite)} OFFSET ${from.p(offset)}`,
      from.params
    );
    return res.json({ total: total.rows[0].n, activos: rows.rows });
  } catch (e) { next(e); }
}

const ORIGINAL_FONT = { name: 'Aptos Narrow', size: 11, family: 2, scheme: 'minor' };
const ORIGINAL_HEADER_FONT = { ...ORIGINAL_FONT, bold: true };
const MONEY_FMT = '#,##0.00';
const FECHA_FMT = '[$-1540A]dd-mmm-yy;@';

// Mismo orden/estilo que "Control de AFT cmg rev01.xlsx" (hoja Activos)
const EXPORT_COLS = [
  { header: 'Codigo', key: 'codigo', width: undefined },
  { header: 'Descripcion', key: 'descripcion', width: 65.6640625 },
  { header: 'Marca', key: 'marca', width: 19.6640625 },
  { header: 'Modelo', key: 'modelo', width: 20 },
  { header: 'Valor CUP', key: 'valor_cup', width: 11.5546875, numFmt: MONEY_FMT, hidden: true },
  { header: 'Categoria', key: 'categoria', width: 3.109375, hidden: true },
  { header: 'Sucursal', key: 'sucursal', width: 13.109375 },
  { header: 'Fecha de Adquisicion', key: 'fecha_adquisicion', width: 20.5546875, numFmt: FECHA_FMT },
  { header: 'Ubicación', key: 'ubicacion', width: 16.88671875 },
  { header: 'Custodio', key: 'custodio', width: 35.33203125 },
  { header: 'Valor USD', key: 'valor_usd', width: 25.77734375, numFmt: MONEY_FMT },
  { header: 'Comentarios', key: 'comentarios', width: 34.88671875 }
];

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { ...ORIGINAL_HEADER_FONT };
    cell.alignment = { horizontal: 'center' };
  });
}

const valoresFila = (a) => [
  a.codigo ?? null,
  a.descripcion ?? null,
  a.marca ?? null,
  a.modelo ?? null,
  a.valor_cup == null ? null : Number(a.valor_cup),
  a.categoria ?? null,
  a.sucursal ?? null,
  a.fecha_adquisicion ?? null,
  a.ubicacion ?? null,
  a.custodio ?? null,
  a.valor_usd == null ? null : Number(a.valor_usd),
  a.comentarios ?? null
];

function writeActivosSheet(wb, activos, { hoja = 'Activos', tabla = 'Tabla1' } = {}) {
  const ws = wb.addWorksheet(hoja, {
    views: [{ showGridLines: false, zoomScale: 110, zoomScaleNormal: 110 }]
  });

  EXPORT_COLS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.width !== undefined) col.width = c.width;
    if (c.hidden) col.hidden = true;
  });

  // El original es una tabla de Excel ("Tabla1", TableStyleLight13): de ahí salen
  // la cabecera morada, las bandas y los botones de filtro. Sin filas no hay tabla.
  if (activos.length) {
    ws.addTable({
      name: tabla,
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleLight13', showRowStripes: true },
      columns: EXPORT_COLS.map((c) => ({ name: c.header, filterButton: true })),
      rows: activos.map(valoresFila)
    });
  } else {
    ws.getRow(1).values = EXPORT_COLS.map((c) => c.header);
  }

  styleHeaderRow(ws.getRow(1));
  for (let r = 2; r <= activos.length + 1; r++) {
    const row = ws.getRow(r);
    EXPORT_COLS.forEach((def, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { ...ORIGINAL_FONT };
      if (def.numFmt) cell.numFmt = def.numFmt;
    });
  }

  return ws;
}

function writeCategoriaSheet(wb, categorias) {
  const ws = wb.addWorksheet('Categoria', {
    views: [{ showGridLines: false, zoomScale: 110, zoomScaleNormal: 110 }]
  });
  ws.columns = [
    { header: 'Categoria', key: 'nombre', width: 36.5546875 },
    { header: 'Ejemplos', key: 'ejemplos', width: 24.6640625 }
  ];

  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.font = { name: 'Aptos Narrow', size: 14, family: 2, scheme: 'minor', bold: true, color: { theme: 8 } };
  });

  for (const c of categorias) {
    const row = ws.addRow({ nombre: c.nombre, ejemplos: c.ejemplos || null });
    row.eachCell((cell) => {
      cell.font = { name: 'Aptos Narrow', size: 12, family: 2, scheme: 'minor' };
    });
  }
  return ws;
}

// Excel: 31 caracteres como mucho, sin []:*?/\ y sin repetir
function nombreHoja(nombre, wb) {
  const base = nombre.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = base;
  for (let i = 2; wb.getWorksheet(n); i++) n = `${base.slice(0, 27)} (${i})`;
  return n;
}

async function exportActivos(req, res, next) {
  try {
    const { q, categoria, area, ubicacion, custodio, marca, estado } = req.query;
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado });
    const separar = req.query.separar === '1';
    const [rows, cats] = await Promise.all([
      db.getPool().query(
        `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql}
         ORDER BY ${separar ? 'ar.numero NULLS LAST, u.nombre NULLS LAST, ' : ''}a.id`,
        from.params
      ),
      db.getPool().query('SELECT nombre, ejemplos FROM categorias ORDER BY id')
    ]);

    const wb = new ExcelJS.Workbook();
    if (separar) {
      // Una hoja por ubicación, cada una con el formato del original
      const porUbic = new Map();
      for (const a of rows.rows) {
        const k = a.ubicacion_id ?? 'sin';
        if (!porUbic.has(k)) porUbic.set(k, { a, items: [] });
        porUbic.get(k).items.push(a);
      }
      let n = 0;
      for (const { a, items } of porUbic.values()) {
        n++;
        const nombre = `${a.area_numero != null ? 'A' + a.area_numero + ' ' : ''}${a.ubicacion || 'Sin ubicación'}`;
        writeActivosSheet(wb, items, { hoja: nombreHoja(nombre, wb), tabla: `Tabla${n}` });
      }
      if (!n) writeActivosSheet(wb, []);
    } else {
      writeActivosSheet(wb, rows.rows);
    }
    writeCategoriaSheet(wb, cats.rows);

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Control de AFT cmg-${fecha}.xlsx"`);
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
    const nuevoId = r.rows[0].id;
    if (!values[keys.indexOf('codigo')]) {
      await db.getPool().query(`UPDATE activos SET codigo = 'AFT-' || LPAD($1::text, 4, '0') WHERE id = $1`, [nuevoId]);
    }
    await registerMovimiento(db.getPool(), {
      activo_id: nuevoId,
      tipo: 'CREADO',
      ubicacion_destino_id: b.ubicacion_id || null,
      custodio_destino_id: b.custodio_id || null,
      estado_destino: b.estado || 'ACTIVO',
      usuario_id: req.user?.id || null
    });
    const row = await db.getPool().query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.id = $1`, [nuevoId]);
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
    const [categorias, sucursales, areas, ubicaciones, custodios, marcas] = await Promise.all([
      db.getPool().query('SELECT id, nombre, ejemplos FROM categorias ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM sucursales ORDER BY nombre'),
      db.getPool().query(`SELECT ar.id, ar.numero, ar.nombre, ${AREA_ETIQUETA} AS etiqueta FROM areas ar ORDER BY ar.numero`),
      db.getPool().query('SELECT id, nombre, area_id FROM ubicaciones ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM custodios ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM marcas ORDER BY nombre')
    ]);
    return res.json({
      categorias: categorias.rows,
      sucursales: sucursales.rows,
      areas: areas.rows,
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

module.exports = {
  listActivos, getActivo, createActivo, updateActivo, deleteActivo, catalogo, dashboard, exportActivos,
  writeActivosSheet, writeCategoriaSheet
};