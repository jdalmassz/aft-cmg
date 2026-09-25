// "Área 2" o "Área 2 - COMERCIAL" si el área tiene nombre
const AREA_ETIQUETA = `CASE WHEN ar.id IS NULL THEN NULL ELSE 'Área ' || ar.numero || COALESCE(' - ' || NULLIF(ar.nombre, ''), '') END`;

const { condicionSucursal } = require('./alcance');

const ACTIVOS_COLUMNS = `
  a.id, a.tipo, a.cantidad, a.codigo, a.descripcion, a.modelo, a.valor_cup, a.valor_usd,
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

/**
 * El WHERE de toda lectura de activos. TODAS pasan por aquí, y por eso el tipo se
 * filtra aquí y no en cada consulta.
 *
 * Activos fijos y útiles y herramientas comparten tabla (ver schema.sql). El día que una
 * consulta se olvidara del tipo, el inventario de activos fijos —el que se imprime y se
 * firma— saldría con los martillos de la gente dentro. Poniéndolo aquí no hay dónde
 * olvidarlo, y lo que se olvida es el parámetro: entonces sale 'AFT', que es el de
 * siempre y el que no miente.
 */
function buildWhere({ q, categoria, area, ubicacion, custodio, marca, estado, tipo, user }) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  where.push(`a.tipo = ${p(tipo === 'UTIL' ? 'UTIL' : 'AFT')}`);

  if (q) {
    where.push(`(a.descripcion ILIKE ${p('%' + q + '%')} OR a.modelo ILIKE ${p('%' + q + '%')} OR a.codigo ILIKE ${p('%' + q + '%')})`);
  }
  if (categoria) where.push(`a.categoria_id = ${p(categoria)}`);
  if (area) where.push(`u.area_id = ${p(area)}`);
  if (ubicacion) where.push(`a.ubicacion_id = ${p(ubicacion)}`);
  if (custodio) where.push(`a.custodio_id = ${p(custodio)}`);
  if (marca) where.push(`a.marca_id = ${p(marca)}`);
  if (estado) where.push(`a.estado = ${p(estado)}`);

  // Alcance por sucursal: cada sucursal sólo ve sus datos (ver alcance.js).
  const sucursal = condicionSucursal(user, p);
  if (sucursal) where.push(sucursal);

  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params, p };
}

module.exports = { ACTIVOS_COLUMNS, ACTIVOS_FROM, AREA_ETIQUETA, buildWhere };
