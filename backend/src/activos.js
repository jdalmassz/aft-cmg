const db = require('./db');
const ExcelJS = require('exceljs');
const { registerMovimiento } = require('./movimientos');
const { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere } = require('./activos-query');
const alcance = require('./alcance');

/**
 * De qué inventario va esta petición: activos fijos o útiles y herramientas.
 *
 * Lo pone la ruta (`/activos` o `/utiles`), no quien llama: así una pantalla no puede
 * pedir unos y escribir en los otros. Sin ruta que lo diga, activos fijos, que es lo que
 * había antes de que esto existiera.
 */
const tipoDe = (req) => (req.tipoActivo === 'UTIL' ? 'UTIL' : 'AFT');
const esUtil = (req) => tipoDe(req) === 'UTIL';

async function listActivos(req, res, next) {
  try {
    const { q, categoria, area, ubicacion, custodio, marca, estado, limite = 200, offset = 0 } = req.query;
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado, tipo: tipoDe(req), user: req.user });
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

/**
 * Las de un útil: sin ubicación —no tiene— y CON cantidad, que es lo que se cuenta.
 *
 * El resto se deja en el mismo orden que el original de activos fijos a propósito: quien
 * revisa las dos hojas el mismo día no tiene que aprenderse dos sitios para cada dato.
 */
const EXPORT_COLS_UTIL = [
  { header: 'Codigo', key: 'codigo', width: undefined },
  { header: 'Descripcion', key: 'descripcion', width: 65.6640625 },
  { header: 'Marca', key: 'marca', width: 19.6640625 },
  { header: 'Modelo', key: 'modelo', width: 20 },
  { header: 'Cantidad', key: 'cantidad', width: 11 },
  { header: 'Valor CUP', key: 'valor_cup', width: 11.5546875, numFmt: MONEY_FMT, hidden: true },
  { header: 'Categoria', key: 'categoria', width: 3.109375, hidden: true },
  { header: 'Sucursal', key: 'sucursal', width: 13.109375 },
  { header: 'Fecha de Adquisicion', key: 'fecha_adquisicion', width: 20.5546875, numFmt: FECHA_FMT },
  { header: 'Responsable', key: 'custodio', width: 35.33203125 },
  { header: 'Valor USD', key: 'valor_usd', width: 25.77734375, numFmt: MONEY_FMT },
  { header: 'Comentarios', key: 'comentarios', width: 34.88671875 }
];

const columnasDe = (util) => (util ? EXPORT_COLS_UTIL : EXPORT_COLS);

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { ...ORIGINAL_HEADER_FONT };
    cell.alignment = { horizontal: 'center' };
  });
}

const valoresFila = (a, util) => [
  a.codigo ?? null,
  a.descripcion ?? null,
  a.marca ?? null,
  a.modelo ?? null,
  ...(util ? [a.cantidad == null ? null : Number(a.cantidad)] : []),
  a.valor_cup == null ? null : Number(a.valor_cup),
  a.categoria ?? null,
  a.sucursal ?? null,
  a.fecha_adquisicion ?? null,
  ...(util ? [] : [a.ubicacion ?? null]),
  a.custodio ?? null,
  a.valor_usd == null ? null : Number(a.valor_usd),
  a.comentarios ?? null
];

function writeActivosSheet(wb, activos, { hoja, tabla = 'Tabla1', util = false } = {}) {
  const cols = columnasDe(util);
  const ws = wb.addWorksheet(hoja || (util ? 'Utiles' : 'Activos'), {
    views: [{ showGridLines: false, zoomScale: 110, zoomScaleNormal: 110 }]
  });

  cols.forEach((c, i) => {
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
      columns: cols.map((c) => ({ name: c.header, filterButton: true })),
      rows: activos.map((a) => valoresFila(a, util))
    });
  } else {
    ws.getRow(1).values = cols.map((c) => c.header);
  }

  styleHeaderRow(ws.getRow(1));
  for (let r = 2; r <= activos.length + 1; r++) {
    const row = ws.getRow(r);
    cols.forEach((def, i) => {
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
    const util = esUtil(req);
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado, tipo: tipoDe(req), user: req.user });
    // '1' / 'ubicacion': una hoja por ubicación · 'responsable': una hoja por responsable
    // Un útil no tiene ubicación, así que el único corte que existe es el responsable:
    // pedir «separar por ubicación» ahí sería una hoja «Sin ubicación» con todo dentro.
    const separar = util
      ? (req.query.separar ? 'responsable' : '')
      : req.query.separar === 'responsable' ? 'responsable'
        : (req.query.separar === '1' || req.query.separar === 'ubicacion') ? 'ubicacion' : '';
    const [rows, cats] = await Promise.all([
      db.getPool().query(
        `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql}
         ORDER BY ${separar === 'responsable' ? 'cu.nombre NULLS LAST, ' : separar ? 'ar.numero NULLS LAST, u.nombre NULLS LAST, ' : ''}a.id`,
        from.params
      ),
      db.getPool().query('SELECT nombre, ejemplos FROM categorias ORDER BY id')
    ]);

    const wb = new ExcelJS.Workbook();
    if (separar) {
      // Una hoja por ubicación o por responsable, cada una con el formato del original
      const grupos = new Map();
      for (const a of rows.rows) {
        const k = separar === 'responsable' ? (a.custodio_id ?? 'sin') : (a.ubicacion_id ?? 'sin');
        if (!grupos.has(k)) grupos.set(k, { a, items: [] });
        grupos.get(k).items.push(a);
      }
      let n = 0;
      for (const { a, items } of grupos.values()) {
        n++;
        const nombre = separar === 'responsable'
          ? (a.custodio || 'Sin responsable')
          : `${a.area_numero != null ? 'A' + a.area_numero + ' ' : ''}${a.ubicacion || 'Sin ubicación'}`;
        writeActivosSheet(wb, items, { hoja: nombreHoja(nombre, wb), tabla: `Tabla${n}`, util });
      }
      if (!n) writeActivosSheet(wb, [], { util });
    } else {
      writeActivosSheet(wb, rows.rows, { util });
    }
    writeCategoriaSheet(wb, cats.rows);

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${util ? 'Utiles y herramientas cmg' : 'Control de AFT cmg'}-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

async function getActivo(req, res, next) {
  try {
    // Con el tipo: entrando por `/utiles/7` no se puede leer el activo fijo 7.
    const params = [req.params.id, tipoDe(req)];
    const alc = alcance.condicionSucursal(req.user, (v) => { params.push(v); return `$${params.length}`; });
    // Un activo de otra sucursal no existe para quien lo pide: 404, no 403
    // (un 403 confirmaría que ese activo está ahí).
    const r = await db.getPool().query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.id = $1 AND a.tipo = $2${alc ? ` AND ${alc}` : ''}`,
      params
    );
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
    const alc = await alcance.alcanceEscritura(db.getPool(), req.user);
    if (!alc) {
      return res.status(403).json({ error: 'Tu sucursal no tiene datos en este sistema' });
    }
    const util = esUtil(req);
    const keys = ['codigo', 'descripcion', 'marca_id', 'modelo', 'valor_cup', 'valor_usd', 'categoria_id', 'sucursal_id', 'fecha_adquisicion', 'ubicacion_id', 'custodio_id', 'estado', 'comentarios', 'tipo', 'cantidad'];
    const values = keys.map((k) => {
      if (k === 'tipo') return tipoDe(req);
      if (k === 'cantidad') return Number(b.cantidad) > 0 ? Math.trunc(Number(b.cantidad)) : 1;
      // Un útil NO tiene ubicación: va con la persona. Si llega una, se ignora en vez de
      // guardarla a medias, que es lo que haría que un día apareciera en el conteo de un área.
      if (k === 'ubicacion_id' && util) return null;
      return b[k] ?? (k === 'estado' ? 'ACTIVO' : null);
    });
    // Cada sucursal sólo escribe en la suya: el resto no puede colar un
    // activo en otra sucursal mandando sucursal_id en el cuerpo.
    if (!alc.todas) values[keys.indexOf('sucursal_id')] = alc.id;
    const r = await db.getPool().query(
      `INSERT INTO activos (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      values
    );
    const nuevoId = r.rows[0].id;
    if (!values[keys.indexOf('codigo')]) {
      // El código es sólo el número, con cuatro ceros por delante. El inventario
      // al que pertenece lo dice la columna `tipo`, no el código.
      await db.getPool().query(
        `UPDATE activos SET codigo = LPAD($1::text, 4, '0') WHERE id = $1`,
        [nuevoId]
      );
    }
    await registerMovimiento(db.getPool(), {
      activo_id: nuevoId,
      tipo: 'CREADO',
      ubicacion_destino_id: util ? null : (b.ubicacion_id || null),
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
    // `tipo` NO se puede cambiar: un activo fijo no se convierte en un útil por editarlo.
    const allowed = ['codigo', 'descripcion', 'marca_id', 'modelo', 'valor_cup', 'valor_usd', 'categoria_id', 'sucursal_id', 'fecha_adquisicion', 'custodio_id', 'estado', 'comentarios', 'cantidad']
      .concat(esUtil(req) ? [] : ['ubicacion_id']);
    const sets = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    for (const k of allowed) {
      if (k in b) { sets.push(`${k} = ${p(b[k])}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

    // Dónde puede escribir esta persona: su sucursal, o las ocho si su rol es
    // global. Si su sucursal no está en la base, no hay nada que tocar.
    const alc = await alcance.alcanceEscritura(db.getPool(), req.user);
    if (!alc) return res.status(403).json({ error: 'Tu sucursal no tiene datos en este sistema' });
    if (!alc.todas && 'sucursal_id' in b && b.sucursal_id != null && Number(b.sucursal_id) !== alc.id) {
      return res.status(403).json({ error: 'No puedes mover activos a otra sucursal' });
    }

    // La fila tiene que ser de su sucursal y de SU inventario; si no, no existe
    // para ella (404). Así `/utiles/7` no actualiza el activo fijo 7.
    const paramsPrev = [req.params.id, tipoDe(req)];
    const condPrev = alcance.condicionSucursal(req.user, (v) => { paramsPrev.push(v); return `$${paramsPrev.length}`; });
    const prev = await db.getPool().query(
      `SELECT id, ubicacion_id, custodio_id, estado FROM activos WHERE id = $1 AND tipo = $2${condPrev ? ` AND ${condPrev}` : ''}`,
      paramsPrev
    );
    if (prev.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const upd = await db.getPool().query(`UPDATE activos SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (upd.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

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
    const params = [req.params.id, tipoDe(req)];
    const cond = alcance.condicionSucursal(req.user, (v) => { params.push(v); return `$${params.length}`; });
    const r = await db.getPool().query(
      `DELETE FROM activos WHERE id = $1 AND tipo = $2${cond ? ` AND ${cond}` : ''} RETURNING id`,
      params
    );
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
    // EL PANEL ES EL DE LOS ACTIVOS FIJOS. Desde que los útiles viven en la misma
    // tabla, cada cuenta de aquí lleva su `tipo = 'AFT'`: sin eso, el total de activos
    // fijos subiría con cada martillo que alguien diera de alta. Los útiles se cuentan
    // aparte, en su propia cifra.
    //
    // Cada consulta lleva su propio array de parámetros: el alcance por
    // sucursal añade el suyo dentro de cada una.
    const nuevo = () => {
      const params = [];
      return { params, p: (v) => { params.push(v); return `$${params.length}`; } };
    };

    const qTotal = nuevo();
    const cTotal = alcance.condicionSucursal(req.user, qTotal.p);

    const qCat = nuevo();
    const cCat = alcance.condicionSucursal(req.user, qCat.p);

    const qUbi = nuevo();
    const cUbi = alcance.condicionSucursal(req.user, qUbi.p);

    const qEst = nuevo();
    const cEst = alcance.condicionSucursal(req.user, qEst.p);

    const qVal = nuevo();
    const estadoParam = qVal.p('ACTIVO');
    const cVal = alcance.condicionSucursal(req.user, qVal.p);

    const qRec = nuevo();
    const cRec = alcance.condicionSucursal(req.user, qRec.p);

    const qTop = nuevo();
    const cTop = alcance.condicionSucursal(req.user, qTop.p);

    const qUti = nuevo();
    const cUti = alcance.condicionSucursal(req.user, qUti.p);

    const [total, porCategoria, porUbicacion, porEstado, valores, recientes, custodiosTop, utiles] = await Promise.all([
      dbp.query(`SELECT COUNT(*)::int AS total FROM activos a WHERE a.tipo = 'AFT'${cTotal ? ` AND ${cTotal}` : ''}`, qTotal.params),
      dbp.query(`
        SELECT c.nombre, COUNT(a.id)::int AS cantidad
        FROM categorias c LEFT JOIN activos a ON a.categoria_id = c.id AND a.tipo = 'AFT'${cCat ? ` AND ${cCat}` : ''}
        GROUP BY c.id, c.nombre ORDER BY cantidad DESC`, qCat.params),
      dbp.query(`
        SELECT u.nombre, COUNT(a.id)::int AS cantidad
        FROM ubicaciones u LEFT JOIN activos a ON a.ubicacion_id = u.id AND a.estado = 'ACTIVO' AND a.tipo = 'AFT'${cUbi ? ` AND ${cUbi}` : ''}
        GROUP BY u.id, u.nombre ORDER BY u.nombre`, qUbi.params),
      dbp.query(`SELECT estado, COUNT(*)::int AS cantidad FROM activos a WHERE a.tipo = 'AFT'${cEst ? ` AND ${cEst}` : ''} GROUP BY estado`, qEst.params),
      dbp.query(`SELECT COALESCE(SUM(valor_usd),0)::numeric AS valor_usd, COALESCE(SUM(valor_cup),0)::numeric AS valor_cup FROM activos a WHERE a.estado = ${estadoParam} AND a.tipo = 'AFT'${cVal ? ` AND ${cVal}` : ''}`, qVal.params),
      dbp.query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.tipo = 'AFT'${cRec ? ` AND ${cRec}` : ''} ORDER BY a.created_at DESC LIMIT 5`, qRec.params),
      dbp.query(`
        SELECT cu.nombre, COUNT(a.id)::int AS cantidad
        FROM custodios cu JOIN activos a ON a.custodio_id = cu.id AND a.tipo = 'AFT'${cTop ? ` AND ${cTop}` : ''}
        GROUP BY cu.id, cu.nombre ORDER BY cantidad DESC LIMIT 10`, qTop.params),
      // Los útiles: cuántas líneas, cuántas piezas y cuántos responsables los tienen.
      dbp.query(`
        SELECT COUNT(*)::int AS lineas,
               COALESCE(SUM(cantidad), 0)::int AS piezas,
               COUNT(DISTINCT custodio_id)::int AS responsables,
               COUNT(*) FILTER (WHERE custodio_id IS NULL)::int AS sin_responsable
        FROM activos a WHERE a.tipo = 'UTIL'${cUti ? ` AND ${cUti}` : ''}`, qUti.params)
    ]);
    return res.json({
      total: total.rows[0].total,
      porCategoria: porCategoria.rows,
      porUbicacion: porUbicacion.rows,
      porEstado: porEstado.rows,
      valores: valores.rows[0],
      recientes: recientes.rows,
      custodiosTop: custodiosTop.rows,
      utiles: utiles.rows[0]
    });
  } catch (e) { next(e); }
}

module.exports = {
  listActivos, getActivo, createActivo, updateActivo, deleteActivo, catalogo, dashboard, exportActivos,
  writeActivosSheet, writeCategoriaSheet
};