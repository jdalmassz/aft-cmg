// "Área 2" o "Área 2 - COMERCIAL" si el área tiene nombre
const AREA_ETIQUETA = `CASE WHEN ar.id IS NULL THEN NULL ELSE 'Área ' || ar.numero || COALESCE(' - ' || NULLIF(ar.nombre, ''), '') END`;

const ACTIVOS_COLUMNS = `
  a.id, a.codigo, a.descripcion, a.modelo, a.valor_cup, a.valor_usd,
  a.fecha_adquisicion, a.estado, a.comentarios, a.created_at, a.updated_at,
  a.categoria_id, c.nombre AS categoria,
  a.sucursal_id, s.nombre AS sucursal,
  a.ubicacion_id, u.nombre AS ubicacion,
  u.area_id, ar.numero AS area_numero,
  ${AREA_ETIQUETA} AS area,
  a.custodio_id, cu.nombre AS custodio,
  a.marca_id, m.nombre AS marca`;

const ACTIVOS_FROM = `
  FROM activos a
  LEFT JOIN categorias c ON c.id = a.categoria_id
  LEFT JOIN sucursales s ON s.id = a.sucursal_id
  LEFT JOIN ubicaciones u ON u.id = a.ubicacion_id
  LEFT JOIN areas ar ON ar.id = u.area_id
  LEFT JOIN custodios cu ON cu.id = a.custodio_id
  LEFT JOIN marcas m ON m.id = a.marca_id`;

function buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado }) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (q) {
    where.push(`(a.descripcion ILIKE ${p('%' + q + '%')} OR a.modelo ILIKE ${p('%' + q + '%')} OR a.codigo ILIKE ${p('%' + q + '%')})`);
  }
  if (categoria) where.push(`a.categoria_id = ${p(categoria)}`);
  if (area) where.push(`u.area_id = ${p(area)}`);
  if (ubicacion) where.push(`a.ubicacion_id = ${p(ubicacion)}`);
  if (custodio) where.push(`a.custodio_id = ${p(custodio)}`);
  if (marca) where.push(`a.marca_id = ${p(marca)}`);
  if (estado) where.push(`a.estado = ${p(estado)}`);

  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params, p };
}

module.exports = { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere };
