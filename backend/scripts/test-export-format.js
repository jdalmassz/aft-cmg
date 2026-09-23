// Genera un xlsx de prueba con la misma lógica de export y lo compara con el original
const path = require('path');
const os = require('os');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { writeActivosSheet, writeCategoriaSheet } = require('../src/activos');

const ORIGINAL = path.join(os.homedir(), 'Downloads', 'Control de AFT cmg rev01.xlsx');
const OUT = path.join(os.tmpdir(), 'aft-export-test.xlsx');

const sample = [
  {
    codigo: 'AFT-0001', descripcion: 'SILLAS DE MADERA', marca: null, modelo: null,
    valor_cup: null, categoria: 'Muebles, Enseres y Equipos de Oficina', sucursal: 'Camagüey',
    fecha_adquisicion: null, ubicacion: 'COMERCIAL', custodio: 'ALFREDO LAUDELINO HERNANDEZ OLIVA',
    valor_usd: null, comentarios: null
  },
  {
    codigo: 'AFT-0030', descripcion: 'LAPTOP', marca: 'ACER ', modelo: 'ASPIRE 315',
    valor_cup: null, categoria: 'Aparatos y equipos técnicos especiales', sucursal: 'Camagüey',
    fecha_adquisicion: '19-6-26', ubicacion: 'ECONOMIA', custodio: 'DAYANA GARCIA ARENCIBIA',
    valor_usd: 550, comentarios: null
  }
];

const cats = [
  { nombre: 'Edificios y Otras Construcciones', ejemplos: null },
  { nombre: 'Muebles, Enseres y Equipos de Oficina', ejemplos: 'buro, mesa, ventildor, split, refrigerador, nevera' },
  { nombre: 'Maquinarias en General', ejemplos: null },
  { nombre: 'Animales', ejemplos: null },
  { nombre: 'Plantaciones Agrícolas Permanentes', ejemplos: null },
  { nombre: 'Máquinas y equipos energéticos', ejemplos: 'inversor, bateria, paneles' },
  { nombre: 'Equipos de Transporte', ejemplos: null },
  { nombre: 'Aparatos y equipos técnicos especiales', ejemplos: 'laptop, nano, switch, tablet' },
  { nombre: 'Otros Activos', ejemplos: null }
];

function headersOf(ws) {
  const row = ws.getRow(1);
  const out = [];
  for (let c = 1; c <= ws.columnCount; c++) out.push(row.getCell(c).value);
  return out;
}

function widthsOf(ws) {
  const out = [];
  for (let c = 1; c <= ws.columnCount; c++) out.push(ws.getColumn(c).width);
  return out;
}

function hiddenOf(ws) {
  const out = [];
  for (let c = 1; c <= ws.columnCount; c++) out.push(!!ws.getColumn(c).hidden);
  return out;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  writeActivosSheet(wb, sample);
  writeCategoriaSheet(wb, cats);
  await wb.xlsx.writeFile(OUT);

  const orig = new ExcelJS.Workbook();
  await orig.xlsx.readFile(ORIGINAL);
  const gen = new ExcelJS.Workbook();
  await gen.xlsx.readFile(OUT);

  const oA = orig.getWorksheet('Activos');
  const gA = gen.getWorksheet('Activos');
  const oC = orig.getWorksheet('Categoria');
  const gC = gen.getWorksheet('Categoria');

  const checks = [];
  const eq = (name, a, b) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    checks.push({ name, ok, a, b });
    return ok;
  };

  eq('hojas generadas', gen.worksheets.map((w) => w.name), ['Activos', 'Categoria']);
  eq('headers Activos', headersOf(gA), headersOf(oA));
  eq('widths Activos', widthsOf(gA), widthsOf(oA));
  eq('hidden Activos', hiddenOf(gA), hiddenOf(oA));
  eq('headers Categoria', headersOf(gC), headersOf(oC));
  eq('widths Categoria', widthsOf(gC), widthsOf(oC));

  const gH = gA.getRow(1).getCell(1);
  const oH = oA.getRow(1).getCell(1);
  eq('header font bold', gH.font.bold, oH.font.bold);
  eq('header align', gH.alignment, oH.alignment);
  eq('header fill none', gH.fill?.type || 'none', oH.fill?.type || 'none');

  const gV = gA.getRow(3).getCell(11); // Valor USD de laptop
  eq('Valor USD numFmt', gV.numFmt, '#,##0.00');
  eq('Valor USD value', gV.value, 550);

  const gF = gA.getRow(3).getCell(8);
  eq('Fecha numFmt', gF.numFmt, '[$-1540A]dd-mmm-yy;@');

  eq('gridlines Activos', gA.views[0]?.showGridLines, false);
  eq('zoom Activos', gA.views[0]?.zoomScale, 110);

  let fail = 0;
  for (const c of checks) {
    if (!c.ok) {
      fail++;
      console.log('FAIL', c.name, '\n  gen:', JSON.stringify(c.a), '\n  orig:', JSON.stringify(c.b));
    } else {
      console.log('OK  ', c.name);
    }
  }
  console.log(fail ? `\n${fail} fallas` : '\nTodo OK → ' + OUT);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
