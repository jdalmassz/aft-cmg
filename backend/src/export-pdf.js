const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('./db');
const { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere } = require('./activos-query');

const LOGO = path.join(__dirname, 'assets', 'procovar-logo.png');

// El formato de la hoja sale de un modelo en papel de otra empresa; la cabecera y
// los datos son los de Procovar.
const ENTIDAD = 'PROCOVAR S.R.L.';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Carta 612x792
const M = { left: 40, right: 40, top: 36, bottom: 40 };
const COL = {
  codigoFin: 104, // el No. Invent. va alineado a la derecha, como en el modelo
  desc: 118,
  existe: 430,
  falta: 500,
  ruleEnd: 572
};
const ROW_H = 16;
const AREA_H = 20;
const UBIC_H = 17;
const FOOTER_H = 90;

function periodoActual() {
  const d = new Date();
  return `${MESES[d.getMonth()]} / ${d.getFullYear()}`;
}

function metaFrom(req, extra = {}) {
  const q = req.query || {};
  return {
    entidad: ENTIDAD,
    sucursal: extra.sucursal || 'Camagüey',
    area: extra.area || '',
    ubicacion: extra.ubicacion || '',
    conteo: q.conteo || '',
    periodo: q.periodo || periodoActual(),
    generadoPor: q.generadoPor || req.user?.nombre || req.user?.username || '',
    separar: q.separar === '1'
  };
}

function kvLine(doc, x, y, label, value) {
  doc.font('Helvetica-Bold').fontSize(9).text(label, x, y, { lineBreak: false });
  const lw = doc.widthOfString(label);
  doc.font('Helvetica').text(' ' + (value || ''), x + lw, y, { lineBreak: false });
}

function drawHeader(doc, meta) {
  const y0 = M.top;
  let y = y0;

  const lineas = [
    ['Entidad:', meta.entidad],
    ['Sucursal:', meta.sucursal],
    meta.area && ['Área:', meta.area.replace(/^Área /, '')],
    meta.ubicacion && ['Ubicación:', meta.ubicacion],
    ['Conteo:', meta.conteo]
  ].filter(Boolean);
  for (const [k, v] of lineas) {
    kvLine(doc, M.left, y, k, v);
    y += 14;
  }

  doc.font('Helvetica-Bold').fontSize(12)
    .text('Hoja para Realizar el Conteo Físico', M.left, y0 + 30, {
      width: COL.ruleEnd - M.left, align: 'center'
    });
  doc.font('Helvetica-Bold').fontSize(11)
    .text(`Período: ${meta.periodo}`, M.left, y0 + 58, {
      width: COL.ruleEnd - M.left, align: 'center'
    });

  if (fs.existsSync(LOGO)) {
    try {
      doc.image(LOGO, COL.ruleEnd - 130, y0, { width: 130 });
    } catch (_) { /* logo opcional */ }
  }

  doc.font('Helvetica-Bold').fontSize(9)
    .text(`Generado por: ${meta.generadoPor}`, M.left, y0 + 58, {
      width: COL.ruleEnd - M.left, align: 'right'
    });

  const yCols = Math.max(y + 6, y0 + 84);
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('No. Invent.', M.left, yCols, { width: COL.codigoFin - M.left, align: 'right', lineBreak: false });
  doc.text('Descripción', COL.desc, yCols, { lineBreak: false });
  doc.text('Existe', COL.existe, yCols, { width: 42, align: 'center', lineBreak: false });
  doc.text('Falta', COL.falta, yCols, { width: 42, align: 'center', lineBreak: false });

  const yRule = yCols + 14;
  doc.lineWidth(1.2).moveTo(M.left, yRule).lineTo(COL.ruleEnd, yRule).stroke();

  return yRule + 10;
}

function ensureSpace(doc, y, need) {
  if (y + need <= doc.page.height - M.bottom - 14) return y;
  doc.addPage();
  return drawHeader(doc, doc._meta);
}

function drawFooter(doc, y) {
  // Las firmas van al pie de la última página; si no caben, a una página nueva.
  const top = doc.page.height - M.bottom - 14 - FOOTER_H;
  if (y > top) {
    doc.addPage();
    drawHeader(doc, doc._meta);
  }
  const half = (COL.ruleEnd - M.left) / 2;
  const w = half - 10;
  let yy = top + 30;

  doc.font('Helvetica').fontSize(9);
  doc.text('Responsable del Conteo Físico', M.left, yy, { width: w, lineBreak: false });
  doc.text('Responsable del Área', M.left + half, yy, { width: w, lineBreak: false });
  yy += 20;
  doc.text('Nombre(s) y Apellidos: ______________________', M.left, yy, { width: w, lineBreak: false });
  doc.text('Nombre(s) y Apellidos: ______________________', M.left + half, yy, { width: w, lineBreak: false });
  yy += 20;
  doc.text('Firma: ______________________', M.left, yy, { width: w, lineBreak: false });
  doc.text('Firma: ______________________', M.left + half, yy, { width: w, lineBreak: false });
}

function numerarPaginas(doc) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(`Página ${i - start + 1} de ${count}`, M.left, doc.page.height - M.bottom, {
        width: COL.ruleEnd - M.left, align: 'right', lineBreak: false
      });
    doc.fillColor('black');
  }
}

// Área → ubicaciones → activos, en el orden en que llegan (ya ordenados por SQL).
function agrupar(activos) {
  const areas = new Map();
  for (const a of activos) {
    const ka = a.area_id != null ? String(a.area_id) : 'sin';
    if (!areas.has(ka)) {
      areas.set(ka, { etiqueta: a.area || 'Sin área asignada', ubicaciones: new Map() });
    }
    const ubics = areas.get(ka).ubicaciones;
    const ku = a.ubicacion_id != null ? String(a.ubicacion_id) : 'sin';
    if (!ubics.has(ku)) {
      ubics.set(ku, { id: a.ubicacion_id, nombre: a.ubicacion || 'Sin ubicación', items: [] });
    }
    ubics.get(ku).items.push(a);
  }
  return [...areas.values()].map((ar) => ({ ...ar, ubicaciones: [...ar.ubicaciones.values()] }));
}

const etiqueta = (id, nombre) => (id != null ? `${id} - ${nombre}` : nombre);

function writeConteoPdf(doc, activos, meta) {
  doc._meta = meta;
  let y = drawHeader(doc, meta);

  if (!activos.length) {
    doc.font('Helvetica-Oblique').fontSize(10)
      .text('No hay activos que coincidan con la selección.', M.left, y + 10, { lineBreak: false });
    y += 30;
  }

  let primeraUbic = true;
  for (const area of agrupar(activos)) {
    let primeraDelArea = true;
    for (const ubic of area.ubicaciones) {
      // Separado: cada ubicación en su página, con sus propias firmas
      if (doc._meta.separar && !primeraUbic) {
        drawFooter(doc, y);
        doc.addPage();
        y = drawHeader(doc, doc._meta);
        primeraDelArea = true;
      }
      primeraUbic = false;
      if (primeraDelArea) {
        y = ensureSpace(doc, y, AREA_H + UBIC_H + ROW_H);
        doc.font('Helvetica-Bold').fontSize(10).text(area.etiqueta, M.left, y, { lineBreak: false });
        y += AREA_H;
        primeraDelArea = false;
      }
      y = ensureSpace(doc, y, UBIC_H + ROW_H);
      doc.font('Helvetica-Bold').fontSize(9)
        .text(`Ubicación: ${etiqueta(ubic.id, ubic.nombre)}`, M.left + 12, y, { lineBreak: false });
      y += UBIC_H;

      for (const a of ubic.items) {
        y = ensureSpace(doc, y, ROW_H);
        doc.font('Helvetica').fontSize(9);
        doc.text(a.codigo || '', M.left, y, {
          width: COL.codigoFin - M.left, align: 'right', lineBreak: false
        });
        doc.text(a.descripcion || '', COL.desc, y, {
          lineBreak: false, ellipsis: true,
          width: COL.existe - COL.desc - 16
        });
        doc.lineWidth(0.6)
          .moveTo(COL.existe, y + 10).lineTo(COL.existe + 42, y + 10).stroke()
          .moveTo(COL.falta, y + 10).lineTo(COL.falta + 42, y + 10).stroke();
        y += ROW_H;
      }
      y += 4;
    }
    y += 4;
  }

  drawFooter(doc, y);
  numerarPaginas(doc);
  return doc;
}

async function exportActivosPdf(req, res, next) {
  try {
    const { q, categoria, area, ubicacion, custodio, marca } = req.query;
    // Un conteo físico es de lo que hay: sin filtro de estado, sólo los activos.
    const estado = req.query.estado || 'ACTIVO';
    const pool = db.getPool();
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado });
    const rows = await pool.query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql}
       ORDER BY ar.numero NULLS LAST, u.nombre NULLS LAST, a.codigo NULLS LAST, a.id`,
      from.params
    );

    const [ar, ub] = await Promise.all([
      area ? pool.query(`SELECT ${AREA_ETIQUETA} AS etiqueta FROM areas ar WHERE ar.id = $1`, [area]) : null,
      ubicacion ? pool.query('SELECT id, nombre FROM ubicaciones WHERE id = $1', [ubicacion]) : null
    ]).then((rs) => rs.map((r) => r?.rows[0] || null));

    const meta = metaFrom(req, {
      sucursal: rows.rows[0]?.sucursal,
      area: ar ? ar.etiqueta : '',
      ubicacion: ub ? etiqueta(ub.id, ub.nombre) : ''
    });
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      bufferPages: true,
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

module.exports = { exportActivosPdf, writeConteoPdf, metaFrom };
