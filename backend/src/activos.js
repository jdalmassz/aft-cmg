const db = require('./db');
const ExcelJS = require('exceljs');
const { registerMovimiento } = require('./movimientos');
const { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere, ordenUbicaciones } = require('./activos-query');
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

/**
 * Tasa de cambio para estimar en CUP los activos que sólo tienen valor en
 * dólares (en la hoja original casi ningún activo tiene valor_cup).
 *
 * No se guarda en la base: la tasa cambia cada semana y no debe tocar los datos
 * de los activos. La fija quien despliega con la variable `TASA_CAMBIO` (en
 * Dokploy → Environment del app); sin variable, la tasa dada por quien mantiene
 * el proyecto: **750 CUP/USD el 26/09/2026**.
 */
const tasaCambio = () => {
  const t = Number(process.env.TASA_CAMBIO);
  return Number.isFinite(t) && t > 0 ? t : 750;
};

async function listActivos(req, res, next) {
  try {
    const { q, categoria, area, ubicacion, custodio, marca, estado, limite = 200, offset = 0 } = req.query;
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado, tipo: tipoDe(req), user: req.user });
    // El total y la página salen en paralelo: dos idas a la base en el mismo tiempo
    // en vez de una detrás de otra. Los parámetros del total se copian ANTES de
    // añadir los de LIMIT/OFFSET, que sólo los lleva la segunda consulta.
    const paramsTotal = from.params.slice();
    const sqlFilas =
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql} ORDER BY a.id ASC LIMIT ${from.p(limite)} OFFSET ${from.p(offset)}`;
    const [total, rows] = await Promise.all([
      db.getPool().query(`SELECT COUNT(*)::int AS n ${ACTIVOS_FROM} ${from.sql}`, paramsTotal),
      // En el mismo orden que el Excel y el PDF: `0001` arriba y el último
      // abajo. Antes salía `a.id DESC` y el más reciente encabeza la lista.
      db.getPool().query(sqlFilas, from.params)
    ]);
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

// En la exportación la ubicación sale sin el número: «COMERCIAL 1» es «COMERCIAL».
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
  ...(util ? [] : [a.ubicacion ? a.ubicacion.replace(/\s*\d+$/, '') : null]),
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
         ORDER BY ${separar === 'responsable' ? 'cu.nombre NULLS LAST, ' : separar ? `ar.numero NULLS LAST, ${ordenUbicaciones('u.')}, ` : ''}a.id`,
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

/**
 * Un error que se contesta con su propio código (400) y no como 500.
 */
function rechazo(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const limpioNombre = (v) => String(v || '').trim().toUpperCase();

/**
 * La ubicación de un activo, decidida por ÁREA y RESPONSABLE — nunca por el número
 * de una ubicación elegido a ciegas.
 *
 * El modelo tiene una sola regla: cada ubicación es de una sola persona («ALMACEN 1»
 * es la de ALIESKI, «ALMACEN 2» la de CARLOS). Pero en el formulario eso se veía como
 * una lista de nombres numerados sin decir de quién es cada uno, y quien editaba un
 * activo que estaba en el almacén no sabía cuál de los tres almacenes tocaba.
 *
 * Aquí se le pregunta lo que sí se sabe: ¿en qué área está? ¿y quién responde por él?
 * La ubicación sale de ahí:
 *
 *  1. Si en esa área ya hay una ubicación con activos de ese responsable, se usa esa.
 *  2. Si no, se crea la siguiente de la familia («ALMACEN 4»), con el área que le toca.
 *  3. Sin responsable, la de la propia área si la actual sigue ahí; si no, la base
 *     («ALMACEN»), que es la que sobra y la que absorbe la renumeración.
 *  4. Sin área que decidir (no la mandan y la actual no tiene), no se toca nada.
 *
 * Devuelve `{ id }` o `null` («déjala como está»). Lanza 400 si no hay con qué decidir.
 */
async function resolverUbicacion(pool, { area_id, custodio_id, ubicacion_actual = null }) {
  const areaId = area_id === undefined || area_id === null || area_id === '' ? null : Number(area_id);
  const custoId = custodio_id === undefined || custodio_id === null || custodio_id === '' ? null : Number(custodio_id);

  let area = null;
  if (areaId) {
    const r = await pool.query('SELECT id, nombre FROM areas WHERE id = $1', [areaId]);
    if (!r.rowCount) throw rechazo('El área elegida no existe');
    area = r.rows[0];
  } else if (ubicacion_actual) {
    const r = await pool.query(
      `SELECT ar.id, ar.nombre FROM ubicaciones u JOIN areas ar ON ar.id = u.area_id WHERE u.id = $1`,
      [ubicacion_actual]
    );
    area = r.rows[0] || null;
  }

  // Sin área no hay con qué decidir: lo que tenía se queda como estaba.
  if (!area) {
    if (custoId && !ubicacion_actual) throw rechazo('Elige el área donde está el activo');
    return null;
  }

  if (custoId) {
    const propia = await pool.query(
      `SELECT u.id FROM ubicaciones u JOIN activos a ON a.ubicacion_id = u.id
        WHERE u.area_id = $1 AND a.custodio_id = $2
        GROUP BY u.id ORDER BY COUNT(a.id) DESC, u.id LIMIT 1`,
      [area.id, custoId]
    );
    if (propia.rowCount) return { id: propia.rows[0].id };
  } else if (ubicacion_actual) {
    const r = await pool.query('SELECT id, area_id FROM ubicaciones WHERE id = $1', [ubicacion_actual]);
    if (r.rows[0] && Number(r.rows[0].area_id) === Number(area.id)) return { id: r.rows[0].id };
  }

  const enArea = (await pool.query('SELECT id, nombre FROM ubicaciones WHERE area_id = $1 ORDER BY id', [area.id])).rows;

  // La familia es el nombre del área (ALMACEN → «ALMACEN 1»…); si el área no tiene
  // nombre, la de cualquier ubicación que ya esté dentro. Sin las dos, no se inventa.
  const familia = limpioNombre(area.nombre) || (enArea[0] ? limpioNombre(enArea[0].nombre).replace(/\s*\d+$/, '') : '');
  if (!familia) throw rechazo('Ese área no tiene nombre: pónle nombre en la pantalla Áreas antes de mover activos ahí');

  // Sin responsable no hay persona a la que numerar: se va a la base de la familia.
  if (!custoId) {
    const base = enArea.find((u) => limpioNombre(u.nombre) === familia);
    if (base) return { id: base.id };
    return crearUbicacion(pool, familia, area.id);
  }

  const numeros = enArea
    .filter((u) => limpioNombre(u.nombre) === familia || limpioNombre(u.nombre).startsWith(familia + ' '))
    .map((u) => Number((limpioNombre(u.nombre).match(/(\d+)$/) || [])[1] || 0));
  let n = Math.max(0, ...numeros) + 1;
  let nombre = `${familia} ${n}`;
  // El nombre es único en toda la tabla: si ya existe en otra área, se salta el número.
  for (;;) {
    const choque = await pool.query('SELECT 1 FROM ubicaciones WHERE nombre = $1', [nombre]);
    if (!choque.rowCount) break;
    n += 1;
    nombre = `${familia} ${n}`;
  }
  return crearUbicacion(pool, nombre, area.id);
}

async function crearUbicacion(pool, nombre, areaId) {
  const r = await pool.query(
    'INSERT INTO ubicaciones (nombre, area_id) VALUES ($1, $2) RETURNING id',
    [nombre, areaId]
  );
  return { id: r.rows[0].id, creada: true };
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
    // Dónde queda el activo: por área y responsable, no por un número a ciegas.
    const donde = util
      ? null
      : await resolverUbicacion(db.getPool(), { area_id: b.area_id, custodio_id: b.custodio_id });
    const keys = ['codigo', 'descripcion', 'marca_id', 'modelo', 'valor_cup', 'valor_usd', 'categoria_id', 'sucursal_id', 'fecha_adquisicion', 'ubicacion_id', 'custodio_id', 'estado', 'comentarios', 'tipo', 'cantidad'];
    const values = keys.map((k) => {
      if (k === 'tipo') return tipoDe(req);
      if (k === 'cantidad') return Number(b.cantidad) > 0 ? Math.trunc(Number(b.cantidad)) : 1;
      // Un útil NO tiene ubicación: va con la persona. Si llega una, se ignora en vez de
      // guardarla a medias, que es lo que haría que un día apareciera en el conteo de un área.
      if (k === 'ubicacion_id') return util ? null : (donde ? donde.id : (b.ubicacion_id ?? null));
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
      ubicacion_destino_id: util ? null : (donde ? donde.id : (b.ubicacion_id || null)),
      custodio_destino_id: b.custodio_id || null,
      estado_destino: b.estado || 'ACTIVO',
      usuario_id: req.user?.id || null
    });
    const row = await db.getPool().query(`SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} WHERE a.id = $1`, [nuevoId]);
    return res.status(201).json(row.rows[0]);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
}

async function updateActivo(req, res, next) {
  try {
    const b = req.body;
    // `tipo` NO se puede cambiar: un activo fijo no se convierte en un útil por editarlo.
    const allowed = ['codigo', 'descripcion', 'marca_id', 'modelo', 'valor_cup', 'valor_usd', 'categoria_id', 'sucursal_id', 'fecha_adquisicion', 'custodio_id', 'estado', 'comentarios', 'cantidad']
      .concat(esUtil(req) ? [] : ['ubicacion_id']);

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
    // `activos a` CON ALIAS, y no es cosmético: `condicionSucursal` escribe
    // `a.sucursal_id …` porque su alias por defecto es `a`. Sin aliasear aquí, Postgres
    // contestaba `missing FROM-clause entry for table "a"` y el guardado reventaba.
    //
    // No se veía desde una cuenta global —un DESARROLLADOR o un SUPER ADMIN no llevan
    // condición de sucursal, así que la consulta salía limpia— ni desde una cuenta sin
    // sucursal, que devuelve `FALSE` y tampoco nombra la tabla. Reventaba justo para
    // quien SÍ tiene sucursal: Junior y Arais no podían editar ni un activo.
    const prev = await db.getPool().query(
      `SELECT a.id, a.ubicacion_id, a.custodio_id, a.estado FROM activos a WHERE a.id = $1 AND a.tipo = $2${condPrev ? ` AND ${condPrev}` : ''}`,
      paramsPrev
    );
    if (prev.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    const viejo = prev.rows[0];

    /*
     * DÓNDE QUEDA EL ACTIVO: por ÁREA y RESPONSABLE, nunca por un número de
     * ubicación elegido a ciegas (ver `resolverUbicacion`).
     *
     * Sólo se decide cuando cambia algo de lo que depende: el área elegida o el
     * responsable. Si alguien sólo corrige el valor o los comentarios, la
     * ubicación no se toca — así un guardado cualquiera no reubica a nadie.
     */
    if (!esUtil(req)) {
      const areaEnCuerpo = 'area_id' in b && b.area_id !== null && b.area_id !== '';
      const cambiaResponsable = 'custodio_id' in b && Number(b.custodio_id || 0) !== Number(viejo.custodio_id || 0);
      if (areaEnCuerpo || cambiaResponsable) {
        let areaActual = null;
        if (viejo.ubicacion_id) {
          const ua = await db.getPool().query('SELECT area_id FROM ubicaciones WHERE id = $1', [viejo.ubicacion_id]);
          areaActual = ua.rows[0]?.area_id != null ? Number(ua.rows[0].area_id) : null;
        }
        const areaPedida = areaEnCuerpo ? Number(b.area_id) : areaActual;
        if (areaPedida !== areaActual || cambiaResponsable) {
          const donde = await resolverUbicacion(db.getPool(), {
            area_id: areaPedida,
            custodio_id: 'custodio_id' in b ? b.custodio_id : viejo.custodio_id,
            ubicacion_actual: viejo.ubicacion_id
          });
          if (donde) b.ubicacion_id = donde.id;
        }
      }
    }

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
    if (upd.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });

    const old = viejo;
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
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
}

async function deleteActivo(req, res, next) {
  try {
    const params = [req.params.id, tipoDe(req)];
    const cond = alcance.condicionSucursal(req.user, (v) => { params.push(v); return `$${params.length}`; });
    // Mismo alias y por lo mismo que en `updateActivo`: sin él, `a.sucursal_id` no
    // resuelve y el borrado falla para todo el que tenga sucursal.
    const r = await db.getPool().query(
      `DELETE FROM activos a WHERE a.id = $1 AND a.tipo = $2${cond ? ` AND ${cond}` : ''} RETURNING a.id`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

/**
 * EL CATÁLOGO TAMBIÉN TIENE ALCANCE. Es lo que alimenta todos los desplegables.
 *
 * Aquí no había ninguno: a cualquiera que entrara por Accesos —fuera de la sucursal que
 * fuera— se le mandaban las seis áreas de Camagüey, sus cubículos, **todos los
 * responsables con nombre y apellidos**, las marcas, y encima `responsablesPorArea`, que
 * dice cuántos activos tiene cada persona. El inventario sí estaba filtrado y salía
 * vacío, así que la pantalla parecía correcta; los nombres viajaban igual en la
 * respuesta del catálogo.
 *
 * Un dato que no se pinta no es un dato que no se manda. Lo encontró Jose el 30/09/2026
 * con «todo el mundo va a ver Camagüey», y tenía razón: no en el inventario, aquí.
 *
 * Lo que se puede recortar HOY es `responsablesPorArea`, que sale de `activos` y por
 * tanto tiene sucursal. Las áreas, ubicaciones, responsables, marcas y categorías **no
 * tienen `sucursal_id`** —son tablas globales, AFT nació de una sola sucursal—, así que
 * a quien no es de aquí se le devuelven VACÍAS: es lo único honesto mientras no exista
 * la columna. Cuando entre el multi-sucursal, esto pasa a filtrar por la suya en vez de
 * vaciar. Ver `Pendiente/AFT` en la bóveda.
 */
async function catalogo(req, res, next) {
  try {
    // Quien no ve ninguna sucursal de esta base no ve tampoco sus nombres propios.
    const alc = await alcance.alcanceEscritura(db.getPool(), req.user);
    if (!alc) {
      return res.json({
        categorias: [], sucursales: [], areas: [], ubicaciones: [],
        custodios: [], marcas: [], responsablesPorArea: []
      });
    }
    const qResp = { params: [], p: (v) => { qResp.params.push(v); return `$${qResp.params.length}`; } };
    const cResp = alcance.condicionSucursal(req.user, qResp.p);
    const [categorias, sucursales, areas, ubicaciones, custodios, marcas, respArea] = await Promise.all([
      db.getPool().query('SELECT id, nombre, ejemplos FROM categorias ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM sucursales ORDER BY nombre'),
      db.getPool().query(`SELECT ar.id, ar.numero, ar.nombre, ${AREA_ETIQUETA} AS etiqueta, ar.responsable_id, c.nombre AS responsable FROM areas ar LEFT JOIN custodios c ON c.id = ar.responsable_id ORDER BY ar.numero`),
      db.getPool().query(`SELECT id, nombre, area_id FROM ubicaciones ORDER BY ${ordenUbicaciones()}`),
      db.getPool().query('SELECT id, nombre FROM custodios ORDER BY nombre'),
      db.getPool().query('SELECT id, nombre FROM marcas ORDER BY nombre'),
      // Quién tiene activos en cada área: es de donde sale el selector de
      // «Responsable del área» de la hoja de conteo (y el que firma si no se elige).
      db.getPool().query(`
        SELECT u.area_id, a.custodio_id, c.nombre, COUNT(*)::int AS activos
          FROM activos a
          JOIN ubicaciones u ON u.id = a.ubicacion_id
          JOIN custodios c ON c.id = a.custodio_id
         WHERE a.tipo = 'AFT' AND a.estado = 'ACTIVO'${cResp ? ` AND ${cResp}` : ''}
         GROUP BY u.area_id, a.custodio_id, c.nombre
         ORDER BY c.nombre`, qResp.params)
    ]);
    return res.json({
      categorias: categorias.rows,
      sucursales: sucursales.rows,
      areas: areas.rows,
      ubicaciones: ubicaciones.rows,
      custodios: custodios.rows,
      marcas: marcas.rows,
      responsablesPorArea: respArea.rows
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

    const [total, porCategoria, porArea, porEstado, valores, recientes, custodiosTop, utiles] = await Promise.all([
      dbp.query(`SELECT COUNT(*)::int AS total FROM activos a WHERE a.tipo = 'AFT'${cTotal ? ` AND ${cTotal}` : ''}`, qTotal.params),
      dbp.query(`
        SELECT c.nombre, COUNT(a.id)::int AS cantidad
        FROM categorias c LEFT JOIN activos a ON a.categoria_id = c.id AND a.tipo = 'AFT'${cCat ? ` AND ${cCat}` : ''}
        GROUP BY c.id, c.nombre ORDER BY cantidad DESC`, qCat.params),
      dbp.query(`
        SELECT ${AREA_ETIQUETA} AS nombre, COUNT(a.id)::int AS cantidad
        FROM areas ar
        LEFT JOIN ubicaciones u ON u.area_id = ar.id
        LEFT JOIN activos a ON a.ubicacion_id = u.id AND a.estado = 'ACTIVO' AND a.tipo = 'AFT'${cUbi ? ` AND ${cUbi}` : ''}
        GROUP BY ar.id, ar.numero ORDER BY ar.numero`, qUbi.params),
      dbp.query(`SELECT estado, COUNT(*)::int AS cantidad FROM activos a WHERE a.tipo = 'AFT'${cEst ? ` AND ${cEst}` : ''} GROUP BY estado`, qEst.params),
      dbp.query(`SELECT COALESCE(SUM(valor_usd),0)::numeric AS valor_usd, COALESCE(SUM(valor_cup),0)::numeric AS valor_cup, COALESCE(SUM(valor_usd) FILTER (WHERE valor_cup IS NULL),0)::numeric AS valor_usd_sin_cup FROM activos a WHERE a.estado = ${estadoParam} AND a.tipo = 'AFT'${cVal ? ` AND ${cVal}` : ''}`, qVal.params),
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
    const v = valores.rows[0];
    const tasa = tasaCambio();
    return res.json({
      total: total.rows[0].total,
      porCategoria: porCategoria.rows,
      porArea: porArea.rows,
      porEstado: porEstado.rows,
      // El total en CUP: lo que ya esté en valor_cup + los activos que sólo
      // tienen dólares, convertidos con la tasa. Sólo se convierten los que no
      // tienen valor_cup, para que nadie se cuente dos veces.
      valores: {
        valor_usd: v.valor_usd,
        valor_cup: Number(v.valor_cup) + Number(v.valor_usd_sin_cup) * tasa,
        tasa
      },
      recientes: recientes.rows,
      custodiosTop: custodiosTop.rows,
      utiles: utiles.rows[0]
    });
  } catch (e) { next(e); }
}

module.exports = {
  listActivos, getActivo, createActivo, updateActivo, deleteActivo, catalogo, dashboard, exportActivos,
  writeActivosSheet, writeCategoriaSheet, resolverUbicacion
};