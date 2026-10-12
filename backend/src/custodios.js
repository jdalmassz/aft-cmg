const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('./db');
const ExcelJS = require('exceljs');

const { AREA_ETIQUETA } = require('./activos-query');

const LOGO = path.join(__dirname, 'assets', 'procovar-logo.png');

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
      SELECT cu.id, cu.nombre, cu.carnet, cu.cargo, cu.user_id, us.username, COUNT(a.id)::int AS activos
      FROM custodios cu
      LEFT JOIN activos a ON a.custodio_id = cu.id
      LEFT JOIN users us ON us.id = cu.user_id
      GROUP BY cu.id, cu.nombre, cu.carnet, cu.cargo, us.username
      ORDER BY cu.nombre`),
      areasPorCustodio(pool)
    ]);
    return res.json(r.rows.map((c) => ({ ...c, areas: areasDe.get(c.id) || [] })));
  } catch (e) { next(e); }
}

// Carnet y cargo van en el acta de responsabilidad material: no son obligatorios,
// pero si se guardan vacíos se devuelven como null (nada de huecos con espacios).
function datoTexto(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

async function createCustodio(req, res, next) {
  try {
    const nombre = (req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'INSERT INTO custodios (nombre, carnet, cargo, user_id) VALUES ($1, $2, $3, $4) RETURNING id, nombre, carnet, cargo, user_id',
      [nombre, datoTexto(req.body?.carnet), datoTexto(req.body?.cargo), req.body?.user_id || null]
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
      'UPDATE custodios SET nombre = $1, carnet = $2, cargo = $3, user_id = $4 WHERE id = $5 RETURNING id, nombre, carnet, cargo, user_id',
      [nombre, datoTexto(req.body?.carnet), datoTexto(req.body?.cargo), req.body?.user_id || null, req.params.id]
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
    const q = (req.query.q || '').trim();
    const cond = q ? `WHERE cu.nombre ILIKE $1` : '';
    const args = q ? [`%${q}%`] : [];
    const [r, areasDe] = await Promise.all([
      pool.query(`
        SELECT cu.id, cu.nombre, COUNT(a.id)::int AS activos
        FROM custodios cu
        LEFT JOIN activos a ON a.custodio_id = cu.id
        ${cond}
        GROUP BY cu.id, cu.nombre
        ORDER BY cu.nombre`, args),
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

/**
 * PDF «Responsables y áreas»: la MISMA hoja que el Excel, en papel Carta.
 * Cabecera con el logo y la entidad (igual que el resto de hojas del sistema),
 * tabla de tres columnas y paginación con la página al pie.
 */
// Carta 612x792
const M = { left: 40, right: 40, top: 36, bottom: 40 };
const COL = { resp: 190, areas: 380, fin: 572 }; // fin = borde derecho de la tabla
const ROW_H = 16;
const HEAD_H = 22;

function dibujarCabecera(doc) {
  const y0 = M.top;
  doc.font('Helvetica-Bold').fontSize(12)
    .text('Responsables y Áreas', M.left, y0, { width: COL.fin - M.left, align: 'center' });
  doc.font('Helvetica').fontSize(9)
    .text('PROCOVAR S.R.L. · Camagüey', M.left, y0 + 18, { width: COL.fin - M.left, align: 'center' });
  if (fs.existsSync(LOGO)) {
    try { doc.image(LOGO, COL.fin - 110, y0 - 4, { width: 110 }); } catch (_) { /* logo opcional */ }
  }
  const yHead = y0 + 44;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Responsable', M.left + 4, yHead + 5, { lineBreak: false });
  doc.text('Áreas', COL.resp + 4, yHead + 5, { lineBreak: false });
  doc.text('Activos', COL.areas + 4, yHead + 5, { width: COL.fin - COL.areas - 8, align: 'right', lineBreak: false });
  doc.lineWidth(1.2).moveTo(M.left, yHead + HEAD_H - 8).lineTo(COL.fin, yHead + HEAD_H - 8).stroke();
  return yHead + HEAD_H;
}

function numerarPaginas(doc, etiqueta) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(`${etiqueta} · Página ${i - start + 1} de ${count}`, M.left, doc.page.height - M.bottom, {
        width: COL.fin - M.left, align: 'right', lineBreak: false
      });
    doc.fillColor('black');
  }
}

async function exportCustodiosPdf(req, res, next) {
  try {
    const pool = db.getPool();
    const q = (req.query.q || '').trim();
    const cond = q ? `WHERE cu.nombre ILIKE $1` : '';
    const args = q ? [`%${q}%`] : [];
    const [r, areasDe] = await Promise.all([
      pool.query(`
        SELECT cu.id, cu.nombre, COUNT(a.id)::int AS activos
        FROM custodios cu
        LEFT JOIN activos a ON a.custodio_id = cu.id
        ${cond}
        GROUP BY cu.id, cu.nombre
        ORDER BY cu.nombre`, args),
      areasPorCustodio(pool)
    ]);
    const filas = r.rows.map((c) => ({
      nombre: c.nombre,
      areas: (areasDe.get(c.id) || []).join(', '),
      activos: c.activos
    }));

    const fecha = new Date().toISOString().slice(0, 10);
    const doc = new PDFDocument({
      size: 'LETTER', margin: 0, bufferPages: true,
      info: { Title: 'Responsables y Áreas', Author: req.user?.nombre || 'AFT Camagüey' }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Responsables-y-areas-${fecha}.pdf"`);
    doc.pipe(res);

    let y = dibujarCabecera(doc);
    doc.font('Helvetica').fontSize(9);
    for (const f of filas) {
      // El alto de la fila lo manda la celda de áreas: puede llevar varias.
      const hAreas = doc.heightOfString(f.areas || '—', { width: COL.areas - COL.resp - 8 });
      const h = Math.max(ROW_H, hAreas + 6);
      if (y + h > doc.page.height - M.bottom - 16) {
        doc.addPage();
        y = dibujarCabecera(doc);
        doc.font('Helvetica').fontSize(9);
      }
      doc.text(f.nombre, M.left + 4, y + 3, { width: COL.resp - M.left - 8 });
      doc.text(f.areas || '—', COL.resp + 4, y + 3, { width: COL.areas - COL.resp - 8 });
      doc.text(String(f.activos), COL.areas + 4, y + 3, { width: COL.fin - COL.areas - 8, align: 'right', lineBreak: false });
      doc.lineWidth(0.5).strokeColor('#bbb')
        .moveTo(M.left, y + h - 2).lineTo(COL.fin, y + h - 2).stroke()
        .strokeColor('black');
      y += h;
    }
    if (!filas.length) {
      doc.font('Helvetica-Oblique').fontSize(10)
        .text('No hay responsables registrados.', M.left, y + 10, { lineBreak: false });
    }

    numerarPaginas(doc, 'Responsables y Áreas');
    doc.end();
  } catch (e) { next(e); }
}

/*
 * Acta de Reconocimiento y Aceptación de Responsabilidad Material
 * (Decreto Ley 249): la MISMA proforma que se firma en papel, pero con el
 * nombre, el carnet y el cargo del responsable puestos y los conteos de la
 * BD (Activos Fijos y Útiles). Medios de Rotación y Medios Monetarios el
 * sistema no los lleva, así que se dejan en blanco para completarlos a mano.
 */
const ACTA_ENTIDAD = 'PROCOVAR S.R.L.';
const ACTA_TITULO = 'ACTA DE RECONOCIMIENTO Y ACEPTACIÓN AL AMPARO DEL DECRETO LEY 249 DE RESPONSABILIDAD MATERIAL SOBRE LOS RECURSOS MATERIALES Y/O FINANCIEROS ASIGNADOS';

// Un trazo para los huecos que quedan en blanco (carnet/cargo sin dato, medios
// que el sistema no controla).
function guion(doc, x, y, ancho) {
  doc.lineWidth(0.6).moveTo(x, y).lineTo(x + ancho, y).stroke();
}

/**
 * Párrafo con tramos en negrita (los datos del responsable) y huecos en blanco:
 * PDFKit no admite fuentes mezcladas en un mismo text(), así que se parte en
 * palabras, se mide cada una y se coloca cortando línea cuando se llena.
 * Devuelve la Y en la que quedó el final del párrafo.
 */
function dibujarParr(doc, tokens, x0, y0, ancho, altoLinea) {
  const espacio = () => doc.widthOfString(' ');
  let x = x0;
  let y = y0;
  let primera = true;

  for (const tok of tokens) {
    const fuente = tok.b ? 'Helvetica-Bold' : 'Helvetica';
    if (tok.vacio) {
      // Sin dato: un trazo del ancho de un hueco de carnet.
      const w = 90;
      if (x + w > x0 + ancho && x > x0) { x = x0; y += altoLinea; }
      if (!primera) { x += espacio(); }
      guion(doc, x, y + 11, w);
      x += w;
      primera = false;
      continue;
    }
    for (const palabra of tok.t.split(/\s+/)) {
      if (!palabra) continue;
      doc.font(fuente);
      const w = doc.widthOfString(palabra);
      // Una coma o un punto pegados al dato dejan sin espacio: «…RODRIGUEZ,».
      const conEspacio = !primera && !/^[,.;:)]/.test(palabra);
      if (x + w > x0 + ancho && x > x0) { x = x0; y += altoLinea; }
      else if (conEspacio) x += espacio();
      doc.text(palabra, x, y, { lineBreak: false });
      x += w;
      primera = false;
    }
  }
  return y + altoLinea;
}

async function exportActaPdf(req, res, next) {
  try {
    const pool = db.getPool();
    const id = Number(req.params.id);
    const r = await pool.query('SELECT id, nombre, carnet, cargo FROM custodios WHERE id = $1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Responsable no encontrado' });
    const cu = r.rows[0];

    const conteos = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE tipo = 'AFT')::int  AS fijos,
        COUNT(*) FILTER (WHERE tipo = 'UTIL')::int AS utiles
      FROM activos WHERE custodio_id = $1`, [id]);

    const fecha = new Date().toISOString().slice(0, 10);
    const doc = new PDFDocument({
      size: 'LETTER', margin: 0, bufferPages: true,
      info: { Title: `Acta de responsabilidad material - ${cu.nombre}`, Author: req.user?.nombre || 'AFT Camagüey' }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Acta-responsabilidad-${cu.nombre.replace(/\s+/g, '_')}-${fecha}.pdf"`);
    doc.pipe(res);

    const W = doc.page.width - M.left - M.right; // ancho útil
    let y = M.top;

    if (fs.existsSync(LOGO)) {
      try { doc.image(LOGO, (doc.page.width - 150) / 2, y, { width: 150 }); y += 64; } catch (_) { /* logo opcional */ }
    }

    doc.font('Helvetica-Bold').fontSize(11)
      .text(ACTA_TITULO, M.left, y, { width: W, align: 'center' });
    y = doc.y + 14;

    // El primer párrafo lleva los datos del responsable en negrita dentro del
    // texto, como en la proforma original. PDFKit no mezcla fuentes en un solo
    // text(), así que se mide y se dibuja palabra por palabra.
    const tokens = [
      { t: 'Yo' }, { t: cu.nombre, b: true },
      { t: ', con número de Carnet de Identidad,' }, { vacio: !cu.carnet, t: cu.carnet, b: true },
      { t: ', que ocupa el cargo (o responsabilidad)' }, { vacio: !cu.cargo, t: cu.cargo, b: true },
      { t: ', en la entidad' }, { t: ACTA_ENTIDAD, b: true },
      { t: ', declaro reconocer formalmente la responsabilidad con los recursos materiales y/o financieros asignados y de los cuales ostento la posesión, asumiendo su debida custodia, control y conservación.' }
    ];
    y = dibujarParr(doc, tokens, M.left, y, W, 15) + 10;

    doc.font('Helvetica').fontSize(10.5)
      .text('De producirse daños, perjuicios, deterioro o extravío a los recursos materiales y/o financieros a mí asignados, la autoridad que resulte competente está en el pleno derecho de exigir la responsabilidad material que se derive, según la normativa vigente.',
        M.left, y, { width: W, align: 'justify' });
    y = doc.y + 14;

    doc.font('Helvetica-Bold').fontSize(10.5)
      .text('Los recursos materiales y/o financieros por los cuales me responsabilizo son:', M.left, y, { width: W });
    y = doc.y + 12;

    // Los dos primeros huecos salen con el conteo real de la BD; los otros dos
    // quedan en blanco (Medios de Rotación y Medios Monetarios).
    const items = [
      { rotulo: 'Activos Fijos Tangibles:', valor: String(conteos.rows[0].fijos) },
      { rotulo: 'Útiles y Herramientas:', valor: String(conteos.rows[0].utiles) },
      { rotulo: 'Medios de Rotación:', valor: '' },
      { rotulo: 'Medios Monetarios:', valor: '' }
    ];
    doc.font('Helvetica').fontSize(10.5);
    for (const it of items) {
      doc.text(it.rotulo, M.left, y, { lineBreak: false });
      const xDato = M.left + doc.widthOfString(it.rotulo) + 8;
      if (it.valor) doc.text(it.valor, xDato, y, { lineBreak: false });
      else guion(doc, xDato, y + 11, 160);
      y += 22;
    }

    // Firmas al pie de la hoja.
    const yFirma = doc.page.height - M.bottom - 56;
    doc.font('Helvetica').fontSize(10.5);
    doc.lineWidth(0.8).strokeColor('black');
    doc.moveTo(M.left, yFirma).lineTo(M.left + 200, yFirma).stroke();
    doc.moveTo(M.left + 260, yFirma).lineTo(M.left + W, yFirma).stroke();
    doc.text('Firma del responsable', M.left, yFirma + 6, { width: 200, align: 'center' });
    doc.text('Fecha de notificación:', M.left + 260, yFirma + 6, { width: W - 260, align: 'center' });
    doc.moveTo(M.left, yFirma + 44).lineTo(M.left + 200, yFirma + 44).stroke();
    doc.moveTo(M.left + 260, yFirma + 44).lineTo(M.left + W, yFirma + 44).stroke();
    doc.text('Firma del Director', M.left, yFirma + 50, { width: 200, align: 'center' });
    doc.text('Control Contable', M.left + 260, yFirma + 50, { width: W - 260, align: 'center' });

    doc.end();
  } catch (e) { next(e); }
}

module.exports = { listCustodios, createCustodio, updateCustodio, deleteCustodio, exportCustodiosXlsx, exportCustodiosPdf, exportActaPdf };
