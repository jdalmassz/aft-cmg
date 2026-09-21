# AFT Camagüey — Sistema de Logística de Activos Fijos Tangibles

Aplicación web para el control y la logística de los activos de la empresa
(sucursal **Camagüey**). Datos iniciales importados de
`Control de AFT cmg rev01.xlsx` (57 activos).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Vue 3 + Vite + Vue Router (SPA) |
| Backend | Node.js + Express 5 |
| Base de datos | PostgreSQL |
| Despliegue | Docker (Dokploy) |

## Estructura

```
aft-cmg/
├── backend/
│   └── src/
│       ├── server.js      # API Express + sirve el frontend construido
│       ├── db.js          # Pool de PostgreSQL + esquema + seeds
│       ├── schema.sql     # Esquema de la base
│       ├── data/
│       │   └── seed_activos.sql   # Los 57 activos del Excel
│       ├── auth.js        # JWT + middleware
│       ├── users.js       # login / me / admin inicial
│       ├── users-admin.js # gestión de usuarios
│       └── activos.js     # CRUD de activos + catálogo + dashboard
├── frontend/
│   └── src/  # Vue: login, dashboard, inventario, usuarios
├── Dockerfile            # Construye el frontend y sirve todo con Node
└── docker-compose.yml    # app + postgres (para prueba local)
```

## Arranque en local

```bash
# 1) Levanta PostgreSQL (16+) y la app
docker compose up --build
# app en http://localhost:8080 — admin / admin123

# 2) O en modo desarrollo (necesita un Postgres a mano):
cd backend  && npm install && npm run dev   # http://localhost:8080
cd frontend && npm install && npm run dev   # http://localhost:5173 (proxy a /api)
```

La base y las tablas se crean solas al arrancar (migración automática). El seed
de los 57 activos se aplica una sola vez (controlado en `schema_seeds`).

## Acceso inicial

- **Usuario:** `admin`
- **Contraseña:** `admin123`

> Cambia la contraseña y las variables `ADMIN_PASSWORD`/`JWT_SECRET` antes de uso
> real. Ver `backend/.env.example`.

## Configuración (variables de entorno)

| Variable | Descripción | Default |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión completa a PostgreSQL | — |
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | Conexión por partes | localhost / 5432 / aft / — / aft_cmg |
| `JWT_SECRET` | Secreto para firmar tokens | cambia-este-secreto |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin creado si no existe | admin / admin123 |
| `PORT` | Puerto de la API | 8080 |

## Despliegue en Dokploy

Ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## API

Documentación: [`docs/API.md`](docs/API.md) (también en Obsidian).