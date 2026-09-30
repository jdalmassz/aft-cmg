const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('./db');
const { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere, ordenUbicaciones } = require('./activos-query');

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
const FOOTER_H = 90;

function periodoActual() {
  const d = new Date();
  return `${MESES[d.getMonth()]} / ${d.getFullYear()}`;
}

function metaFrom(req, extra = {}) {
  const q = req.query || {};
  // Útiles y herramientas: la misma hoja de conteo, pero sin área ni ubicación —un útil
  // no está en un sitio, está con una persona— y por eso SIEMPRE se corta por responsable.
  const util = req.tipoActivo === 'UTIL';
  return {
    entidad: ENTIDAD,
    util,
    sucursal: extra.sucursal || 'Camagüey',
    area: extra.area || '',
    ubicacion: extra.ubicacion || '',
    responsable: extra.responsable || '',
    // El del filtro, que no cambia al partir por ubicación: es el respaldo de las
    // ubicaciones que no tienen una sola persona detrás.
    responsableFiltro: extra.responsable || '',
    // El que se eligió a mano para firmar como «Responsable del Área».
    responsableAreaSel: extra.responsableAreaSel || '',
    conteo: q.conteo || '',
    periodo: q.periodo || periodoActual(),
    // El responsable enganchado a su usuario manda sobre el nombre de la cuenta: en
    // la hoja hacen falta nombre y apellidos, no el usuario con el que entra.
    generadoPor: extra.generadoPor || q.generadoPor || req.user?.nombre || req.user?.username || '',
    // Cada ubicación o cada responsable en sus páginas, con sus propias firmas
    separar: util
      ? 'responsable'
      : q.separar === 'responsable' ? 'responsable' : (q.separar === '1' || q.separar === 'ubicacion') ? 'ubicacion' : ''
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

  for (const [k, v] of [['Entidad:', meta.entidad], ['Sucursal:', meta.sucursal], ['Conteo:', meta.conteo]]) {
    kvLine(doc, M.left, y, k, v);
    y += 14;
  }

  doc.font('Helvetica-Bold').fontSize(12)
    .text(
      meta.util ? 'Útiles y Herramientas en Uso — Conteo Físico' : 'Hoja para Realizar el Conteo Físico',
      M.left, y0 + 30, { width: COL.ruleEnd - M.left, align: 'center' }
    );
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

  // Quién y dónde: el área de la hoja y la persona que responde por ella. Van los dos
  // ahí arriba, porque quien recibe el papel tiene que leerlo sin interpretar el
  // cuerpo: una hoja firmada por ALIESKI sin decir el almacén no sirve para nada.
  let yCols = y0 + 84;
  const seleccion = [
    meta.area && ['Área:', meta.area],
    meta.responsable && ['Responsable:', meta.responsable]
  ].filter(Boolean);
  if (seleccion.length) {
    let x = M.left;
    for (const [k, v] of seleccion) {
      doc.font('Helvetica-Bold');
      const ancho = doc.widthOfString(k) + doc.widthOfString(' ' + v) + 18;
      // Un nombre largo baja a la siguiente línea en vez de salirse del margen.
      if (x > M.left && x + ancho > COL.ruleEnd) { x = M.left; yCols += 14; }
      kvLine(doc, x, yCols - 6, k, v);
      x += ancho;
    }
    yCols += 14;
  }
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
  const resp = doc._meta.responsable;
  doc.text(
    resp ? (doc._meta.util ? 'Responsable de los útiles' : 'Responsable de los activos') : 'Responsable del Área',
    M.left + half, yy, { width: w, lineBreak: false }
  );
  yy += 20;
  // Si la hoja no es de una sola persona se firma con el responsable del área: el
  // que se eligió a mano en la hoja de conteo, o si no, el de más activos del área.
  const delArea = doc._meta.responsableAreaSel || doc._meta.responsableArea || '';
  /*
   * LOS DOS NOMBRES SALEN PUESTOS. Lo que queda por hacer a mano es firmar.
   *
   * El de la derecha —quien responde de los activos— ya venía relleno cuando se sabía
   * quién es. El de la izquierda —quien hace el conteo— salía SIEMPRE en blanco, y es
   * el que menos sentido tenía dejar vacío: lo está haciendo quien acaba de pulsar el
   * botón, y el sistema sabe su nombre desde que entró. «Que no tengan que escribir,
   * así es firmar solamente» (Jose, 30/09/2026).
   *
   * Si por lo que sea no hay nombre, vuelve la raya: una hoja con un hueco se rellena
   * a bolígrafo, pero una con el nombre equivocado se firma sin mirar.
   */
  const quienCuenta = (doc._meta.generadoPor || '').trim();
  const lineaIzq = `Nombre(s) y Apellidos: ${quienCuenta || '______________________'}`;
  const lineaDer = `Nombre(s) y Apellidos: ${resp || delArea || '______________________'}`;
  // Un nombre largo no se corta: si no cabe en la mitad de la página, baja el
  // tamaño de la letra (las dos mitades juntas, para que queden parejas). Se miden
  // LAS DOS: antes sólo se miraba la derecha, y desde que la izquierda también lleva
  // nombre puede ser ella la que no quepa.
  doc.font('Helvetica').fontSize(9);
  let tam = 9;
  while (tam > 6.5 && Math.max(doc.widthOfString(lineaIzq), doc.widthOfString(lineaDer)) > w) {
    tam -= 0.5;
    doc.fontSize(tam);
  }
  doc.text(lineaIzq, M.left, yy, { width: w, lineBreak: false });
  doc.text(lineaDer, M.left + half, yy, { width: w, lineBreak: false });
  yy += 20;
  doc.font('Helvetica').fontSize(9);
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

// Escribe un bloque Área → Ubicación → activos. Con separar === 'ubicacion' cada
// ubicación arranca página nueva (la anterior cierra con sus firmas).
function escribirLineas(doc, items, y) {
  for (const a of items) {
    y = ensureSpace(doc, y, ROW_H);
    doc.font('Helvetica').fontSize(9);
    doc.text(a.codigo || '', M.left, y, { width: COL.codigoFin - M.left, align: 'right', lineBreak: false });
    // La cantidad va pegada a la descripción y no en columna propia: sólo la llevan los
    // útiles, y una columna que casi siempre dice «1» le quita sitio a lo que sí se lee.
    const desc = (a.descripcion || '') + (Number(a.cantidad) > 1 ? `  (x${a.cantidad})` : '');
    doc.text(desc, COL.desc, y, { lineBreak: false, ellipsis: true, width: COL.existe - COL.desc - 16 });
    doc.lineWidth(0.6)
      .moveTo(COL.existe, y + 10).lineTo(COL.existe + 42, y + 10).stroke()
      .moveTo(COL.falta, y + 10).lineTo(COL.falta + 42, y + 10).stroke();
    y += ROW_H;
  }
  return y;
}

// El nombre con el que se firma la hoja. Cada ubicación es de una sola persona
// (COMERCIAL 1, FACTURACION 2…), así que al partir por ubicación cada quien se
// lleva la suya con su nombre en la cabecera y en la firma. Si la ubicación
// tiene más de un responsable no hay con qué firmar y se devuelve vacío.
function responsableUnico(items) {
  const ids = new Set(items.map((a) => a.custodio_id ?? 'sin'));
  return ids.size === 1 ? items[0].custodio || '' : '';
}

// El nombre con el que se firma la hoja cuando no es de una sola persona: el
// responsable con más activos del área (el mismo que el «1» de la familia).
function responsableDelArea(area) {
  const conteo = new Map();
  for (const ubic of area.ubicaciones) {
    for (const a of ubic.items) {
      if (!a.custodio_id) continue;
      const e = conteo.get(a.custodio_id) || { nombre: a.custodio || '', n: 0 };
      e.n += 1;
      conteo.set(a.custodio_id, e);
    }
  }
  const orden = [...conteo.values()]
    .sort((a, b) => b.n - a.n || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
  return orden[0]?.nombre || '';
}

function escribirBloque(doc, activos, y, estado) {
  // Un útil no tiene área ni ubicación: sus líneas van seguidas bajo el responsable,
  // que ya está en la cabecera y en la firma. Meterlo en el árbol de áreas daría una
  // página entera titulada «Sin área asignada → Sin ubicación».
  if (doc._meta.util) {
    estado.primera = false;
    return escribirLineas(doc, activos, y) + 4;
  }

  // El responsable del filtro (si lo hay) sirve de respaldo para las ubicaciones
  // que no tienen una sola persona detrás. Es el del filtro y no el de la primera
  // ubicación: si ésta tiene varias personas, la firma se queda como estaba.
  const respBase = doc._meta.responsableFiltro || '';

  for (const area of agrupar(activos)) {
    // El de la firma del área mientras se escribe ésta, por si la hoja no es de
    // una sola persona (entonces se firma como «Responsable del Área»).
    doc._meta.responsableArea = responsableDelArea(area);
    let primeraDelArea = true;
    for (const ubic of area.ubicaciones) {
      const porUbicacion = doc._meta.separar === 'ubicacion';
      const nuevo = porUbicacion ? responsableUnico(ubic.items) || respBase : doc._meta.responsable;
      if (porUbicacion && !estado.primera) {
        // La página que se cierra es la de la ubicación anterior: su firma se pinta
        // con el nombre de ésta, y recién entonces se cambia para la que empieza.
        drawFooter(doc, y);
        doc._meta.responsable = nuevo;
        doc.addPage();
        y = drawHeader(doc, doc._meta);
        primeraDelArea = true;
      } else if (porUbicacion) {
        doc._meta.responsable = nuevo;
      }
      estado.primera = false;
      if (primeraDelArea) {
        y = ensureSpace(doc, y, AREA_H + ROW_H);
        doc.font('Helvetica-Bold').fontSize(10).text(area.etiqueta, M.left, y, { lineBreak: false });
        y += AREA_H;
        primeraDelArea = false;
      }
      // Sin el rótulo «Ubicación: …»: con una ubicación por responsable ya se ve
      // en la cabecera de quién es cada hoja, y sólo estorba arriba del listado.
      y = ensureSpace(doc, y, ROW_H);

      y = escribirLineas(doc, ubic.items, y);
      y += 4;
    }
    y += 4;
  }
  return y;
}

function writeConteoPdf(doc, activos, meta) {
  doc._meta = meta;

  if (meta.separar === 'responsable' && activos.length) {
    // Un juego de páginas por responsable, con su nombre en la cabecera y en la firma
    const porResp = new Map();
    for (const a of activos) {
      const k = a.custodio_id ?? 'sin';
      if (!porResp.has(k)) porResp.set(k, { nombre: a.custodio || 'Sin responsable', items: [] });
      porResp.get(k).items.push(a);
    }
    let primero = true;
    for (const g of porResp.values()) {
      if (!primero) doc.addPage();
      primero = false;
      doc._meta = { ...meta, responsable: g.nombre };
      const y = escribirBloque(doc, g.items, drawHeader(doc, doc._meta), { primera: true });
      drawFooter(doc, y);
    }
    numerarPaginas(doc);
    return doc;
  }

  // La cabecera de la primera página se pinta antes de recorrer las ubicaciones,
  // así que, si se parte por ubicación, el nombre del que abre el documento se
  // calcula aquí: ése es el que firma esa primera hoja.
  if (meta.separar === 'ubicacion' && activos.length) {
    const primera = agrupar(activos)[0]?.ubicaciones[0];
    if (primera) meta.responsable = responsableUnico(primera.items) || meta.responsableFiltro || '';
  }

  let y = drawHeader(doc, meta);
  if (!activos.length) {
    doc.font('Helvetica-Oblique').fontSize(10)
      .text('No hay activos que coincidan con la selección.', M.left, y + 10, { lineBreak: false });
    y += 30;
  }
  y = escribirBloque(doc, activos, y, { primera: true });
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
    const util = req.tipoActivo === 'UTIL';
    const from = buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado, tipo: util ? 'UTIL' : 'AFT', user: req.user });
    const rows = await pool.query(
      `SELECT ${ACTIVOS_COLUMNS} ${ACTIVOS_FROM} ${from.sql}
       ORDER BY ${util || req.query.separar === 'responsable' ? 'cu.nombre NULLS LAST, ' : ''}ar.numero NULLS LAST, ${ordenUbicaciones('u.')}, a.codigo NULLS LAST, a.id`,
      from.params
    );

    const [ar, ub, cu, ra, quienCuenta] = await Promise.all([
      area ? pool.query(`SELECT ${AREA_ETIQUETA} AS etiqueta FROM areas ar WHERE ar.id = $1`, [area]) : null,
      ubicacion ? pool.query('SELECT id, nombre FROM ubicaciones WHERE id = $1', [ubicacion]) : null,
      custodio ? pool.query('SELECT nombre FROM custodios WHERE id = $1', [custodio]) : null,
      // Quien se eligió a mano para firmar como responsable del área.
      req.query.resp_area ? pool.query('SELECT nombre FROM custodios WHERE id = $1', [req.query.resp_area]) : null,
      /*
       * EL NOMBRE COMPLETO DE QUIEN ESTÁ CONTANDO, para que no tenga que escribirlo.
       *
       * Sale del RESPONSABLE enganchado a su usuario (`custodios.user_id`) y no del
       * campo `nombre` de la cuenta, porque ahí está el nombre con el que entra —
       * «arais», «Junior», «admin»— y eso en una hoja que se firma no vale: quien la
       * recibe necesita nombre y apellidos. `custodios` los tiene bien escritos porque
       * son los mismos que salen en todo el inventario.
       *
       * Sin responsable enganchado se cae al nombre de la cuenta, y si tampoco, la
       * hoja sale con la raya para rellenar a mano. Una hoja con un hueco se rellena;
       * una con el nombre equivocado se firma sin mirar.
       */
      req.user?.id
        ? pool.query('SELECT nombre FROM custodios WHERE user_id = $1 LIMIT 1', [req.user.id])
        : null
    ]).then((rs) => rs.map((r) => r?.rows[0] || null));

    const meta = metaFrom(req, {
      sucursal: rows.rows[0]?.sucursal,
      area: ar ? ar.etiqueta : '',
      ubicacion: ub ? ub.nombre : '',
      responsable: cu ? cu.nombre : '',
      responsableAreaSel: ra ? ra.nombre : '',
      generadoPor: quienCuenta ? quienCuenta.nombre : ''
    });
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      bufferPages: true,
      info: {
        Title: util ? 'Útiles y Herramientas en Uso — Conteo Físico' : 'Hoja para Realizar el Conteo Físico',
        Author: meta.generadoPor
      }
    });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${util ? 'Utiles-y-herramientas' : 'Conteo-fisico'}-${fecha}.pdf"`);
    doc.pipe(res);
    writeConteoPdf(doc, rows.rows, meta);
    doc.end();
  } catch (e) { next(e); }
}

module.exports = { exportActivosPdf, writeConteoPdf, metaFrom };
