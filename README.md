# AFT Camagüey — Sistema de Logística de Activos Fijos Tangibles

Aplicación web para el control y la logística de los activos de la empresa
(sucursal **Camagüey**). Datos iniciales importados de
`Control de AFT cmg rev01.xlsx` (57 activos).

**Producción**: https://aft.procovar.cloud — desplegada en Dokploy (Proyecto
Procovar-camaguey) con PostgreSQL 16.

## Funcionalidades

- **Entrada por Accesos** (`auth.procovar.cloud`, el SSO de Procovar): la
  pantalla de login sólo redirige hacia allí; la aplicación no tiene usuario ni
  contraseña propios. El login local queda como endpoint de respaldo, sin
  pantalla.
- **Alcance por sucursal**: cada sucursal sólo ve sus datos (activos,
  dashboard, historial y exportaciones). Aquí sólo hay datos de **Camagüey**.
- Gestión de usuarios locales (admin) con sucursal.
- **Gestión de responsables** (custodios): crear, renombrar y eliminar (si no
  tiene activos asignados).
- Inventario con buscador y filtros (categoría, ubicación, responsable, estado).
- **Historial de movimientos** por activo (creación, traslados de ubicación,
  cambios de custodio y estado).
- **Exportación a Excel** (.xlsx) del inventario filtrado, con el **mismo formato
  que el original** `Control de AFT cmg rev01.xlsx` (hojas `Activos` + `Categoria`).
- **Exportación a PDF** de la *Hoja para Realizar el Conteo Físico*, con el
  **mismo formato** que el documento original (agrupado por área, columnas
  Existe/Falta y firmas).
- **Etiquetas QR** imprimibles para cada activo.
- **Código automático** (`AFT-####`) para activos sin código.
- Dashboard con totales, valores, distribución por categoría/ubicación/estado.

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
│       ├── auth.js        # JWT + middleware (lee también la cookie del SSO)
│       ├── procovar-auth.js # firma HMAC, roles de Accesos y sucursales (un solo sitio)
│       ├── auth-sso.js     # /api/auth/entrar y /api/auth/sso/callback
│       ├── auth-logout.js  # borra la cookie httpOnly
│       ├── alcance.js      # cada sucursal sólo ve sus datos
│       ├── users.js       # login / me / admin inicial
│       ├── users-admin.js # gestión de usuarios
│       ├── custodios.js   # gestión de responsables (custodios)
│       └── activos.js     # CRUD de activos + catálogo + dashboard
│   └── scripts/
│       ├── test-auth-sso.js   # roles, sucursales, firma, returnTo, alcance (sin BD)
│       └── test-e2e-sso.js    # el salto entero contra un Postgres y un doble de Accesos
├── frontend/
│   └── src/  # Vue: login, dashboard, inventario, usuarios, responsables
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
| `AFT_AUTH_URL` | URL de Accesos | `https://auth.procovar.cloud` |
| `AFT_AUTH_CLIENT_ID` | `clientId` de tu alta en Accesos | `aft` |
| `AFT_AUTH_SIGNING_KEY` | Clave hex del alta, leída en **hexadecimal** | — (**sin default**) |

## Entrada por Accesos

La única puerta de la pantalla de login es **Accesos**; el login local sigue
como endpoint de respaldo, sin pantalla propia.

```bash
GET /api/auth/entrar?returnTo=/activos   # → redirige a auth.procovar.cloud
GET /api/auth/sso/callback?code=…            # → canjea el código y pone la cookie
POST /auth/login                         # respaldo, si falta la clave
POST /api/auth/logout                    # borra la cookie httpOnly (sin exigir token)
```

- **No se puede registrar nada en Accesos desde aquí: sólo se consume su API.**
  El ClientApp (`clientId`, `signingKey`, `allowedCallbackUrls`) lo da de alta
  Jose. Hay que pedirle que añada como callback
  `https://aft.procovar.cloud/api/auth/sso/callback` y, para trabajar en local,
  `http://localhost:8080/api/auth/sso/callback` (o `:5173` si usas Vite).
- La clave **no va en el repo ni en un fichero**: en Dokploy es variable de
  entorno, y en local va en `backend/.env` (ignorado por git).
- Sin clave no se revienta: `/api/auth/entrar` manda a `/?sso=nodisponible` y
  se entra con usuario y contraseña.
- Los roles y las sucursales se traducen **en un solo sitio**,
  `backend/src/procovar-auth.js`. Los siete roles de Accesos: `DESARROLLADOR` y
  `SUPER ADMIN` ven las ocho sucursales; los otros cinco, sólo la suya; un rol
  desconocido cae siempre al de **menos** permisos.

## Pruebas

```bash
cd backend
node scripts/test-auth-sso.js   # sin base de datos (roles, sucursales, firma)
# necesita un PostgreSQL (por ejemplo `docker compose up -d db`):
node scripts/test-e2e-sso.js    # el salto entero + alcance por sucursal
```

`test-e2e-sso.js` crea una base efímera `aft_e2e_<timestamp>` y la borra al
terminar: no toca tus datos.

## Despliegue en Dokploy

Ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## API

Documentación: [`docs/API.md`](docs/API.md) (también en Obsidian).