const db = require('./db');
const ExcelJS = require('exceljs');

const { AREA_ETIQUETA, ordenUbicaciones } = require('./activos-query');
const { registerMovimiento } = require('./movimientos');

// Un área (Área 1, Área 2…) agrupa varias ubicaciones; cada ubicación pertenece a una sola.

const duplicado = (res, que) => res.status(400).json({ error: `Ya existe ${que} con ese nombre` });
const limpio = (v) => String(v || '').trim().toUpperCase();

// Cada ubicación es de una sola persona y lleva su número: «COMERCIAL 1»,
// «COMERCIAL 2»… El 1 es siempre el responsable con más activos.
//
// FACTURACION está exenta: sus números vienen del Excel original (ROXANA es
// FACTURACION 1) y se cambian a mano, no por esta regla.
const FAMILIAS_EXENTAS = new Set(['FACTURACION']);
const familiaDe = (nombre) => limpio(nombre).replace(/\s*\d+$/, '');
const cmpNombre = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function listAreas(req, res, next) {
  try {
    const pool = db.getPool();
    const [areas, ubicaciones] = await Promise.all([
      pool.query(`
        SELECT ar.id, ar.numero, ar.nombre, ${AREA_ETIQUETA} AS etiqueta,
               ar.responsable_id, c.nombre AS responsable
        FROM areas ar LEFT JOIN custodios c ON c.id = ar.responsable_id
        ORDER BY ar.numero`),
      pool.query(`
        SELECT u.id, u.nombre, u.area_id, COUNT(a.id)::int AS activos
        FROM ubicaciones u LEFT JOIN activos a ON a.ubicacion_id = u.id
        GROUP BY u.id, u.nombre ORDER BY ${ordenUbicaciones('u.')}`)
    ]);
    return res.json({ areas: areas.rows, ubicaciones: ubicaciones.rows });
  } catch (e) { next(e); }
}

// El nombre es obligatorio; el número NUNCA se escribe: al crear lo coge solo
// (el siguiente libre) y al editar no se toca.
function datosArea(body) {
  const nombre = limpio(body?.nombre);
  if (!nombre) return { error: 'Pon el nombre del área' };
  const bruto = body?.responsable_id;
  const responsableId = bruto == null || bruto === '' ? null : Number(bruto);
  if (responsableId !== null && (!Number.isInteger(responsableId) || responsableId < 1)) {
    return { error: 'El responsable del área no es válido' };
  }
  return { nombre, responsableId };
}

async function createArea(req, res, next) {
  try {
    const d = datosArea(req.body);
    if (d.error) return res.status(400).json({ error: d.error });
    // El siguiente número en la propia sentencia: dos altas a la vez no pueden
    // pisarse (si acaso lo hacen, el UNIQUE decide y se reintenta abajo).
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await db.getPool().query(
          `INSERT INTO areas (numero, nombre, responsable_id)
           SELECT COALESCE(MAX(numero), 0) + 1, $1, $2 FROM areas
           RETURNING id, numero, nombre, responsable_id`,
          [d.nombre, d.responsableId]
        );
        return res.status(201).json(r.rows[0]);
      } catch (e) {
        if (e.code !== '23505' || intento === 2) throw e;
      }
    }
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'No se pudo asignar el número del área, intentalo otra vez' });
    if (e.code === '23503') return res.status(400).json({ error: 'Ese responsable no existe' });
    next(e);
  }
}

async function updateArea(req, res, next) {
  try {
    const d = datosArea(req.body);
    if (d.error) return res.status(400).json({ error: d.error });
    const r = await db.getPool().query(
      'UPDATE areas SET nombre = $1, responsable_id = $2 WHERE id = $3 RETURNING id, numero, nombre, responsable_id',
      [d.nombre, d.responsableId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Área no encontrada' });
    return res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'Ese responsable no existe' });
    next(e);
  }
}

/**
 * Borrar un área se lleva por delante sus ubicaciones VACÍAS.
 *
 * Antes bastaba con que el área tuviera una ubicación para negarse, aunque no tuviera
 * ni un activo dentro, y el mensaje decía «muévelas a otra área primero». Eso era un
 * callejón sin salida: desde la pantalla de Áreas no se borra una ubicación suelta, así
 * que un área con un cubículo vacío no había forma de quitarla. Le pasó a Jose el
 * 30/09/2026 con el área 3 después de sacarle el último activo: cero activos, un
 * cubículo vacío, y el botón de eliminar diciendo que no.
 *
 * Lo que de verdad hay que proteger son los DATOS, no las estanterías donde no hay nada:
 *
 *   una ubicación con activos → no se borra nada, y se dice cuál y cuántos
 *   ubicaciones vacías        → se van con el área, aunque estén en el historial
 *
 * Lo segundo sólo es seguro desde que el movimiento guarda el NOMBRE de la ubicación
 * (ver `schema.sql`). Antes la clave ajena lo impedía, y forzarlo habría dejado el
 * movimiento diciendo que el activo vino de ninguna parte. Ahora la referencia se queda
 * en NULL y el renglón sigue contando de dónde salió: «se puede borrar y que se sepa de
 * dónde se movió, y ya» (Jose, 30/09/2026).
 */
async function deleteArea(req, res, next) {
  try {
    const pool = db.getPool();
    const u = await pool.query(
      `SELECT u.id, u.nombre,
              (SELECT COUNT(*)::int FROM activos a WHERE a.ubicacion_id = u.id) AS activos
         FROM ubicaciones u WHERE u.area_id = $1 ORDER BY u.nombre`,
      [req.params.id]
    );

    const conActivos = u.rows.filter((x) => x.activos > 0);
    if (conActivos.length) {
      const detalle = conActivos.map((x) => `«${x.nombre}» (${x.activos})`).join(', ');
      return res.status(400).json({
        error: `No se puede eliminar: todavía hay activos en ${detalle}. Muévelos a otra área primero`
      });
    }

    // En UNA sentencia: si el área se fuera y las ubicaciones no, los activos quedarían
    // apuntando al vacío.
    const r = await pool.query(
      `WITH vacias AS (DELETE FROM ubicaciones WHERE area_id = $1 RETURNING id)
       DELETE FROM areas WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Área no encontrada' });
    return res.json({ ok: true, ubicaciones_borradas: u.rows.length });
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
    // Aparecer en el historial YA NO lo impide. El movimiento guarda el nombre de la
    // ubicación (ver `schema.sql`), así que al borrarla la referencia se queda en NULL
    // y el renglón sigue diciendo de dónde salió el activo. Antes esto era un callejón
    // sin salida: una ubicación vacía nombrada en un traslado no se podía quitar nunca,
    // y con ella se quedaba clavada su área.
    const r = await pool.query('DELETE FROM ubicaciones WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Ubicación no encontrada' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

/**
 * Recalcula los números de las ubicaciones.
 *
 * La regla es una: cada familia (COMERCIAL, ECONOMIA…) queda como «FAM 1»,
 * «FAM 2»…, con el responsable que MÁS activos tiene en el 1, y cada activo en
 * la ubicación de su responsable. Si alguien cambia el responsable de un activo,
 * aquí se vuelve a cuadrar.
 *
 * Se pide a mano desde la pantalla Áreas: los números no se mueven solos, para
 * que un reparto corregido a mano no salte sin avisar.
 */
async function renumerarUbicaciones(req, res, next) {
  try {
    const pool = db.getPool();

    const { rows: temporales } = await pool.query(`SELECT nombre FROM ubicaciones WHERE nombre LIKE '%§%' LIMIT 1`);
    if (temporales.length) {
      return res.status(409).json({
        error: `Quedó el nombre temporal «${temporales[0].nombre}» de una renumeración anterior: se mira antes de seguir`
      });
    }

    const { rows: todas } = await pool.query('SELECT id, nombre, area_id FROM ubicaciones ORDER BY id');
    const familias = [...new Set(todas.map((u) => familiaDe(u.nombre)))]
      .filter((f) => f && !FAMILIAS_EXENTAS.has(f))
      .sort(cmpNombre);

    const resumen = [];
    for (const fam of familias) resumen.push(await renumerarFamilia(pool, fam, req.user?.id || null));
    return res.json({ familias: resumen });
  } catch (e) { next(e); }
}

async function renumerarFamilia(pool, fam, usuarioId) {
  const sobrante = (filas) => filas.map((u) => `«${u.nombre}»`).join(', ');
  const { rows: enFamilia } = await pool.query(
    `SELECT id, nombre, area_id FROM ubicaciones WHERE regexp_replace(nombre, '\\s*\\d+$', '') = $1 ORDER BY id`,
    [fam]
  );
  const { rows: acts } = await pool.query(
    `SELECT a.id, a.ubicacion_id, a.custodio_id, c.nombre AS custodio
       FROM activos a
       JOIN ubicaciones u ON u.id = a.ubicacion_id
       LEFT JOIN custodios c ON c.id = a.custodio_id
      WHERE regexp_replace(u.nombre, '\\s*\\d+$', '') = $1
      ORDER BY a.id`,
    [fam]
  );

  const sinResponsable = acts.filter((a) => !a.custodio_id).length;
  if (sinResponsable) return { familia: fam, motivo: `hay ${sinResponsable} activo(s) sin responsable` };
  if (!acts.length) return { familia: fam, motivo: 'sin activos' };

  const porCustodio = new Map();
  for (const a of acts) {
    const e = porCustodio.get(a.custodio_id) || { id: a.custodio_id, nombre: limpio(a.custodio), n: 0 };
    e.n += 1;
    porCustodio.set(a.custodio_id, e);
  }
  // El 1 siempre es el que más tiene; a igualdad, por nombre, como la lista de
  // responsables, para que el resultado no dependa del orden de la consulta.
  const ranking = [...porCustodio.values()].sort((a, b) => b.n - a.n || cmpNombre(a.nombre, b.nombre));
  if (ranking.length <= 1) return { familia: fam, motivo: 'un solo responsable' };
  if (enFamilia.length > ranking.length) {
    throw new Error(
      `${fam}: hay ${enFamilia.length} ubicaciones y sólo ${ranking.length} responsable(s); sobran y no las borro yo solo`
    );
  }

  const n = ranking.length;
  const objetivos = new Array(n);
  const usadas = new Set();
  for (let i = 0; i < n; i++) {
    const r = enFamilia.find((u) => u.nombre === `${fam} ${i + 1}`);
    if (r) { objetivos[i] = r; usadas.add(r.id); }
  }
  // Lo que sobra (la base «COMERCIAL» y los números que ya no tocan) cubre lo que
  // falta, la base la primera: así el id de siempre se queda en el «1».
  const sobrantes = enFamilia.filter((u) => !usadas.has(u.id))
    .sort((a, b) => (a.nombre === fam ? 0 : 1) - (b.nombre === fam ? 0 : 1) || a.id - b.id);
  for (let i = 0; i < n && sobrantes.length; i++) if (!objetivos[i]) objetivos[i] = sobrantes.shift();
  if (sobrantes.length) {
    throw new Error(`${fam}: sobran ${sobrante(sobrantes)} y no las borro yo solo`);
  }

  const areaBase = (enFamilia.find((u) => u.nombre === fam) || enFamilia[0] || {}).area_id ?? null;
  const original = new Map(enFamilia.map((u) => [u.id, u.nombre]));

  // Primero todas las de la familia a un nombre temporal único (sale del id):
  // así se pueden intercambiar «FAM 1» y «FAM 2» de sitio sin chocar con el
  // UNIQUE de nombre, y las nuevas ya se crean con su nombre definitivo.
  for (const u of enFamilia) {
    const temp = `§${u.id}§`;
    await pool.query('UPDATE ubicaciones SET nombre = $1 WHERE id = $2', [temp, u.id]);
    u.nombre = temp; // lo que se guarda aquí es lo que se compara abajo
  }

  let creadas = 0;
  for (let i = 0; i < n; i++) {
    if (objetivos[i]) continue;
    const r = await pool.query(
      'INSERT INTO ubicaciones (nombre, area_id) VALUES ($1, $2) RETURNING id, nombre, area_id',
      [`${fam} ${i + 1}`, areaBase]
    );
    objetivos[i] = r.rows[0];
    creadas += 1;
  }

  let renombradas = 0;
  for (let i = 0; i < n; i++) {
    const destino = `${fam} ${i + 1}`;
    if (objetivos[i].nombre === destino) continue;
    await pool.query('UPDATE ubicaciones SET nombre = $1 WHERE id = $2', [destino, objetivos[i].id]);
    if (original.get(objetivos[i].id) !== destino) renombradas += 1;
    objetivos[i].nombre = destino;
  }

  let movidos = 0;
  for (let i = 0; i < n; i++) {
    const destino = objetivos[i].id;
    for (const a of acts) {
      if (a.custodio_id !== ranking[i].id || a.ubicacion_id === destino) continue;
      await pool.query('UPDATE activos SET ubicacion_id = $1, updated_at = now() WHERE id = $2', [destino, a.id]);
      await registerMovimiento(pool, {
        activo_id: a.id,
        tipo: 'TRASLADO_UBICACION',
        ubicacion_origen_id: a.ubicacion_id,
        ubicacion_destino_id: destino,
        comentario: 'Renumeración por responsable',
        usuario_id: usuarioId
      });
      movidos += 1;
    }
  }

  return { familia: fam, responsables: n, creadas, renombradas, movidos };
}

/**
 * Excel de áreas: una fila por área con su jefe (el responsable que se asigna
 * en la pantalla Áreas). Ni el listado de responsables de cada área ni el
 * número de activos: esto es gestión de áreas, no inventario.
 */
const FONT = { name: 'Aptos Narrow', size: 11, family: 2, scheme: 'minor' };

async function exportAreasXlsx(req, res, next) {
  try {
    const { rows: areas } = await db.getPool().query(`
      SELECT ar.numero, ${AREA_ETIQUETA} AS etiqueta, c.nombre AS responsable
      FROM areas ar LEFT JOIN custodios c ON c.id = ar.responsable_id
      ORDER BY ar.numero`);

    const filas = areas.map((ar) => [ar.numero, ar.etiqueta, ar.responsable || '']);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Áreas', {
      views: [{ showGridLines: false, zoomScale: 110, zoomScaleNormal: 110 }]
    });
    const columnas = [
      { header: 'Nº', width: 6 },
      { header: 'Área', width: 42 },
      { header: 'Responsable del área', width: 40 }
    ];
    columnas.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

    // Misma tabla que los otros exports (TableStyleLight13): cabecera, bandas y filtros.
    if (filas.length) {
      ws.addTable({
        name: 'TablaAreas',
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
    for (let r = 2; r <= filas.length + 1; r++) {
      ws.getRow(r).eachCell((cell) => { cell.font = { ...FONT }; });
    }

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Areas y responsables-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

/**
 * Orden nuevo de las áreas: la lista de ids es el orden en que se pintan, y los
 * números se recalculan 1..N en ese orden («Área 1…N» queda como la ve la
 * persona en pantalla). Dos pasadas en la misma transacción —primero negativos,
 * después el definitivo— para no chocar con el UNIQUE de `numero`; fuera de la
 * transacción nadie llega a ver los números negativos.
 */
async function reordenarAreas(req, res, next) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (!ids.length || ids.some((n) => !Number.isInteger(n) || n < 1)) {
      return res.status(400).json({ error: 'Falta la lista de áreas en el orden nuevo' });
    }
    const pool = db.getPool();
    const { rows: existentes } = await pool.query('SELECT id FROM areas');
    const conjunto = new Set(existentes.map((r) => r.id));
    const cuadra = ids.length === existentes.length
      && new Set(ids).size === ids.length
      && ids.every((id) => conjunto.has(id));
    if (!cuadra) {
      return res.status(400).json({ error: 'La lista de áreas no cuadra con las que hay: recarga y vuelve a intentarlo' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE areas SET numero = $1 WHERE id = $2', [-(i + 1), ids[i]]);
      }
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE areas SET numero = $1 WHERE id = $2', [i + 1, ids[i]]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listAreas, createArea, updateArea, deleteArea, createUbicacion, updateUbicacion, deleteUbicacion, renumerarUbicaciones, exportAreasXlsx, reordenarAreas };
