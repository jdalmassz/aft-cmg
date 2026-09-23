const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('./db');
const { ACTIVOS_COLUMNS, ACTIVOS_FROM, buildWhere } = require('./activos-query');

const LOGO = path.join(__dirname, 'assets', 'exber-logo.png');

// Cabecera fija del original 20260923-0849.pdf (sobreescribible por query)
const HEADER_DEFAULTS = {
  organismo: 'MINAL',
  entidad: 'EES Empresa de Bebidas y Refresco Camaguey',
  reeup: '111.0.1666',
  unidad: '26 - UEB Com, Aseg y Servicios Camaguey',
  estado: 'Pendiente'
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Layout letter 612x792 — mismas columnas que el original
const M = { left: 40, right: 40, top: 36, bottom: 56 };
const COL = {
  codigo: 52,
  desc: 118,
  existe: 430,
  falta: 500,
  ruleEnd: 572
};
const ROW_H = 16;
const AREA_H = 20;

function periodoActual() {
  const d = new Date();
  return `${MESES[d.getMonth()]} / ${d.getFullYear()}`;
}

function metaFrom(req) {
  const q = req.query || {};
  return {
    organismo: q.organismo || HEADER_DEFAULTS.organismo,
    entidad: q.entidad || HEADER_DEFAULTS.entidad,
    reeup: q.reeup || HEADER_DEFAULTS.reeup,
    unidad: q.unidad || HEADER_DEFAULTS.unidad,
    conteo: q.conteo || '',
    periodo: q.periodo || periodoActual(),
    estado: q.estado || HEADER_DEFAULTS.estado,
    generadoPor: q.generadoPor || req.user?.nombre || req.user?.username || ''
  };
}

function kvLine(doc, x, y, label, value, indent = 0) {
  doc.font('Helvetica-Bold').fontSize(9).text(label, x + indent, y, { lineBreak: false });
  const lw = doc.widthOfString(label);
  doc.font('Helvetica').text(' ' + (value || ''), x + indent + lw, y, { lineBreak: false });
}

function drawHeader(doc, meta) {
  const y0 = M.top;
  let y = y0;

  kvLine(doc, M.left, y, 'Organismo:', meta.organismo);
  y += 14;
  kvLine(doc, M.left, y, 'Entidad:', meta.entidad, 8);
  y += 14;
  kvLine(doc, M.left, y, 'Reeup:', meta.reeup, 8);
  y += 14;
  kvLine(doc, M.left, y, 'Unidad:', meta.unidad, 8);
  y += 16;
  kvLine(doc, M.left, y, 'Conteo:', meta.conteo);
  y += 14;
  kvLine(doc, M.left, y, 'Estado:', meta.estado);

  // Título centrado
  doc.font('Helvetica-Bold').fontSize(12)
    .text('Hoja para Realizar el Conteo Físico', M.left, y0 + 30, {
      width: COL.ruleEnd - M.left, align: 'center'
    });
  doc.font('Helvetica-Bold').fontSize(11)
    .text(`Período: ${meta.periodo}`, M.left, y0 + 72, {
      width: COL.ruleEnd - M.left, align: 'center'
    });

  // Logo arriba a la derecha
  if (fs.existsSync(LOGO)) {
    try {
      doc.image(LOGO, COL.ruleEnd - 115, y0 - 8, { width: 115 });
    } catch (_) { /* logo opcional */ }
  }

  // Generado por (derecha)
  doc.font('Helvetica-Bold').fontSize(9)
    .text(`Generado por: ${meta.generadoPor}`, M.left, y0 + 92, {
      width: COL.ruleEnd - M.left, align: 'right'
    });

  // Cabecera de columnas
  const yCols = y0 + 110;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('No. Invent.', M.left + 8, yCols, { lineBreak: false });
  doc.text('Descripción', COL.desc, yCols, { lineBreak: false });
  doc.text('Existe', COL.existe + 8, yCols, { lineBreak: false });
  doc.text('Falta', COL.falta + 12, yCols, { lineBreak: false });

  // Regla
  const yRule = yCols + 14;
  doc.lineWidth(1.2).moveTo(M.left, yRule).lineTo(COL.ruleEnd, yRule).stroke();

  return yRule + 10;
}

function ensureSpace(doc, y, need) {
  if (y + need <= doc.page.height - M.bottom) return y;
  doc.addPage();
  return drawHeader(doc, doc._meta);
}

function drawFooter(doc) {
  const y = doc.page.height - M.bottom - 40;
  if (y < 120) return;
  const half = (COL.ruleEnd - M.left) / 2;

  doc.font('Helvetica').fontSize(9);
  doc.text('Responsable del Conteo Físico', M.left, y, { width: half - 10, lineBreak: false });
  doc.text('Responsable del Área', M.left + half, y, { width: half - 10, lineBreak: false });

  const y2 = y + 22;
  doc.text('Nombre(s) y Apellidos:', M.left, y2, { width: half - 10, lineBreak: false });
  doc.text('Nombre(s) y Apellidos:', M.left + half, y2, { width: half - 10, lineBreak: false });

  const y3 = y2 + 16;
  doc.text('Firma: ______________________', M.left, y3, { width: half - 10, lineBreak: false });
  doc.text('Firma: ______________________', M.left + half, y3, { width: half - 10, lineBreak: false });
}

function agruparPorArea(activos) {
  const mapa = new Map();
  for (const a of activos) {
    const key = a.ubicacion_id != null ? String(a.ubicacion_id) : 'sin';
    if (!mapa.has(key)) {
      mapa.set(key, {
        id: a.ubicacion_id,
        nombre: a.ubicacion || 'Sin ubicación',
        items: []
      });
    }
    mapa.get(key).items.push(a);
  }
  return [...mapa.values()];
}

function writeConteoPdf(doc, activos, meta) {
  doc._meta = meta;
  let y = drawHeader(doc, meta);
  const areas = agruparPorArea(activos);

  for (const area of areas) {
    y = ensureSpace(doc, y, AREA_H + ROW_H);
    const titulo = area.id != null
      ? `Área: ${area.id} - ${area.nombre}`
      : `Área: ${area.nombre}`;
    doc.font('Helvetica-Bold').fontSize(10).text(titulo, M.left, y, { lineBreak: false });
    y += AREA_H;

    for (const a of area.items) {
      y = ensureSpace(doc, y, ROW_H);
      doc.font('Helvetica').fontSize(9);
      doc.text(a.codigo || '', COL.codigo, y, {
        lineBreak: false,
        width: Math.max(40, COL.desc - COL.codigo - 6)
      });
      doc.text(a.descripcion || '', COL.desc, y, {
        lineBreak: false,
        width: Math.max(60, COL.existe - COL.desc - 16)
      });
      doc.lineWidth(0.6)
        .moveTo(COL.existe, y + 10).lineTo(COL.existe + 42, y + 10).stroke()
        .moveTo(COL.falta, y + 10).lineTo(COL.falta + 42, y + 10).stroke();
      y += ROW_H;
    }
    y += 4;
  }

  drawFooter(doc);
  return doc;
}

async function exportActivosPdf(req, res, next) {
  try {
    const { q, categoria, ubicacion, custodio, marca, estado } = req.query;
    const from = buildWhere({ q, categoria, ubicacion, custodio, marca, estado });
    const rows = await db.getPool().query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql} ORDER BY a.ubicacion_id NULLS LAST, a.codigo NULLS LAST, a.id`,
      from.params
    );

    const meta = metaFrom(req);
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      info: { Title: 'Hoja para Realizar el Conteo Físico', Author: meta.generadoPor }
    });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Conteo-fisico-${fecha}.pdf"`);
    doc.pipe(res);
    writeConteoPdf(doc, rows.rows, meta);
    doc.end();
  } catch (e) { next(e); }
}

module.exports = { exportActivosPdf, writeConteoPdf, metaFrom, HEADER_DEFAULTS };
