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

CREATE TABLE IF NOT EXISTS ubicaciones (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS custodios (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_activos_categoria ON activos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_activos_ubicacion ON activos(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_activos_custodio ON activos(custodio_id);
CREATE INDEX IF NOT EXISTS idx_activos_descripcion ON activos(descripcion);