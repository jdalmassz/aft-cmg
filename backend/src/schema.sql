-- Esquema del sistema de logística de activos (AFT) - PostgreSQL

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre TEXT,
  rol TEXT NOT NULL DEFAULT 'admin',
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  ejemplos TEXT
);

CREATE TABLE IF NOT EXISTS sucursales (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

-- Un área (Área 1, Área 2…) agrupa varias ubicaciones. El nombre es opcional.
CREATE TABLE IF NOT EXISTS areas (
  id SERIAL PRIMARY KEY,
  numero INTEGER UNIQUE NOT NULL,
  nombre TEXT
);

CREATE TABLE IF NOT EXISTS ubicaciones (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES areas(id);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_area ON ubicaciones(area_id);

CREATE TABLE IF NOT EXISTS custodios (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

-- Un responsable puede ser además un usuario del sistema
ALTER TABLE custodios ADD COLUMN IF NOT EXISTS user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS marcas (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS activos (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE,
  descripcion TEXT NOT NULL,
  marca_id INTEGER REFERENCES marcas(id),
  modelo TEXT,
  valor_cup NUMERIC(14,2),
  valor_usd NUMERIC(14,2),
  categoria_id INTEGER REFERENCES categorias(id),
  sucursal_id INTEGER REFERENCES sucursales(id),
  fecha_adquisicion TEXT,
  ubicacion_id INTEGER REFERENCES ubicaciones(id),
  custodio_id INTEGER REFERENCES custodios(id),
  estado TEXT NOT NULL DEFAULT 'ACTIVO',
  comentarios TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ÚTILES Y HERRAMIENTAS: la otra mitad del inventario.
--
-- Un activo fijo está EN UN SITIO: un área, una ubicación, y alguien responde por él.
-- Un útil va CON UNA PERSONA — se lo lleva a su casa si hace falta— y por eso no tiene
-- ubicación: lo que hay que saber es quién lo tiene. Son dos controles distintos y se
-- firman por separado, pero los datos son los mismos (código, descripción, marca, valor,
-- estado), y tener dos tablas gemelas sería duplicar el alta, el historial y los exportes
-- para que un día se arreglen en una y no en la otra.
--
-- Así que viven en la misma tabla con una marca. LA MARCA MANDA: toda lectura pasa por
-- `buildWhere` (activos-query.js), que SIEMPRE filtra por tipo y da 'AFT' por defecto.
-- Un filtro olvidado enseña activos fijos de menos, nunca útiles colados en el inventario
-- de activos fijos, que es el que se firma.
ALTER TABLE activos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'AFT';
ALTER TABLE activos DROP CONSTRAINT IF EXISTS activos_tipo_check;
ALTER TABLE activos ADD CONSTRAINT activos_tipo_check CHECK (tipo IN ('AFT', 'UTIL'));

-- Un activo fijo es UNO. De un útil puede haber diez iguales en la misma línea —diez
-- destornilladores— y contarlos de uno en uno sería inventarles diez códigos.
ALTER TABLE activos ADD COLUMN IF NOT EXISTS cantidad INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_activos_tipo ON activos(tipo);
CREATE INDEX IF NOT EXISTS idx_activos_categoria ON activos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_activos_ubicacion ON activos(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_activos_custodio ON activos(custodio_id);
CREATE INDEX IF NOT EXISTS idx_activos_descripcion ON activos(descripcion);

-- Historial de movimientos de los activos (logística)
CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- CREADO | TRASLADO_UBICACION | CAMBIO_CUSTODIO | CAMBIAR_ESTADO
  ubicacion_origen_id INTEGER REFERENCES ubicaciones(id),
  ubicacion_destino_id INTEGER REFERENCES ubicaciones(id),
  custodio_origen_id INTEGER REFERENCES custodios(id),
  custodio_destino_id INTEGER REFERENCES custodios(id),
  estado_origen TEXT,
  estado_destino TEXT,
  comentario TEXT,
  usuario_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_activo ON movimientos(activo_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(created_at DESC);

-- Backfill idempotente: registro inicial de activos existentes antes del historial
INSERT INTO movimientos (activo_id, tipo, ubicacion_destino_id, custodio_destino_id, estado_destino)
SELECT a.id, 'CREADO', a.ubicacion_id, a.custodio_id, a.estado
FROM activos a
WHERE NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.activo_id = a.id);

-- Backfill idempotente: código automático para los que no traen uno. El prefijo dice
-- de qué inventario es, que es lo primero que se mira en una hoja impresa.
UPDATE activos SET codigo = CASE WHEN tipo = 'UTIL' THEN 'UH-' ELSE 'AFT-' END || LPAD(id::text, 4, '0')
WHERE codigo IS NULL OR codigo = '';

-- Backfill idempotente: ejemplos de categorías (del Excel original)
UPDATE categorias SET ejemplos = CASE nombre
  WHEN 'Muebles, Enseres y Equipos de Oficina' THEN 'buro, mesa, ventildor, split, refrigerador, nevera'
  WHEN 'Máquinas y equipos energéticos' THEN 'inversor, bateria, paneles'
  WHEN 'Aparatos y equipos técnicos especiales' THEN 'laptop, nano, switch, tablet'
  ELSE ejemplos
END
WHERE nombre IN (
  'Muebles, Enseres y Equipos de Oficina',
  'Máquinas y equipos energéticos',
  'Aparatos y equipos técnicos especiales'
);