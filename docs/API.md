# API — Sistema AFT Camagüey

- **Producción**: `https://aft.procovar.cloud`
- **Local**: `http://localhost:8080`

Formato de respuesta: JSON. Errores: `{ "error": "mensaje" }` con el código HTTP
correspondiente.

## Autenticación

La única puerta de la pantalla de login es **Accesos**
(`auth.procovar.cloud`): la app redirige hacia allí y recibe a la persona de
vuelta con un código de un solo uso (60 s). **No hay usuario ni contraseña
propios.** El **login local** (`/auth/login`) sigue montado como respaldo,
sin pantalla propia.

### Entrar por Accesos

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/auth/entrar?returnTo=/activos` | GET (o POST) | Redirige a Accesos. `returnTo` es opcional y **se valida contra el propio origen** |
| `/api/auth/sso/callback?code=…` | GET | Vuelve de Accesos con el código (60 s, un solo uso) y canjea el token |
| `/auth/login` | POST | Login local de respaldo `{ username, password }` |
| `/api/auth/logout` | POST | Borra la cookie httpOnly. **No exige token**: tiene que funcionar también con la sesión ya caducada |

Tras el callback la sesión viaja en una **cookie `httpOnly`** (`aft_sso`), no en
`localStorage`: el callback es servidor y esa es la única forma de escribirla.
Las peticiones pueden llevar el token igual en `Authorization: Bearer <jwt>`, que
es como funciona el login local.

Códigos de error en la URL (el motivo entero va al registro del servidor):

| Query | Significado |
|---|---|
| `?sso=nodisponible` | Falta `AFT_AUTH_SIGNING_KEY`; la pantalla avisa y el respaldo es `/auth/login` |
| `?sso=sincodigo` | Vino al callback sin `?code=` |
| `?sso=error` | Falló la ida o el canje (firma, `callbackUrl` no dada de alta, código caducado/reutilizado) |

### `POST /auth/login` (respaldo, sin pantalla)

Cuerpo:
```json
{ "username": "admin", "password": "admin123" }
```

Respuesta `200`:
```json
{
  "token": "<jwt>",
  "user": { "id": "...", "username": "admin", "nombre": "Administrador", "rol": "admin",
            "activo": true, "sucursal": "CAM", "sucursalNombre": "Camagüey",
            "rol_accesos": null, "sinDatos": false }
}
```

### `GET /api/me`

Devuelve el usuario autenticado con esos mismos campos:

| Campo | Qué es |
|---|---|
| `rol` | Rol interno: `admin` o `usuario` |
| `sucursal` | Código de la sucursal en Accesos (`CAM`, `GR`, …); `null` si no la hay |
| `sucursalNombre` | Nombre de esa sucursal (`Camagüey`, …); `null` si no está en la tabla |
| `rol_accesos` | El rol tal cual venía de Accesos (uno de los siete); `null` en cuentas locales |
| `sinDatos` | `true` si su sucursal no tiene datos en este sistema (entra, pero no ve nada) |

### `POST /api/me/password`

Cambia la propia contraseña.
```json
{ "current": "admin123", "nuevo": "nueva-clave" }
```

### Roles y sucursales (los siete, en un solo sitio)

La traducción vive en `backend/src/procovar-auth.js`; el resto de la aplicación
sólo mira `rol` y `sucursal`.

| Rol de Accesos | Rol interno | Alcance |
|---|---|---|
| `DESARROLLADOR` | `admin` | las ocho sucursales |
| `SUPER ADMIN` | `admin` | las ocho sucursales |
| `GERENTE` | `usuario` | su sucursal |
| `ADMINISTRADOR` | `usuario` | su sucursal (**una**: no es admin del sistema) |
| `SUPERVISOR` | `usuario` | su sucursal |
| `GESTOR` | `usuario` | su sucursal |
| `OPERADOR` | `usuario` | su sucursal |
| cualquier otro | `usuario` | su sucursal (rol desconocido → el de **menos** permisos) |

La sucursal sale del `slug` de la organización en Accesos, en mayúsculas
(`cam` → `CAM`). **Cada sucursal sólo ve sus datos**: activos, dashboard,
historial y exportaciones se filtran por `sucursales.nombre`. Si la sucursal de
la persona no está en la base, entra igual pero no ve nada (`sinDatos: true`).

Las cuentas locales (las creadas con `/api/admin/users`) son de Camagüey.

## Catálogo

### `GET /api/catalogo`

Diccionarios para los formularios: `categorias`, `sucursales`, `ubicaciones`,
`custodios`, `marcas`. Cada uno con `[{ id, nombre }]`.

## Dashboard

### `GET /api/dashboard`

```json
{
  "total": 57,
  "porCategoria": [{ "nombre": "...", "cantidad": 26 }],
  "porUbicacion": [{ "nombre": "LOGISTICA", "cantidad": 4 }],
  "porEstado": [{ "estado": "ACTIVO", "cantidad": 57 }],
  "valores": { "valor_usd": "8192.65", "valor_cup": "0" },
  "recientes": [ { "id": 1, "descripcion": "...", ... } ],
  "custodiosTop": [ { "nombre": "...", "cantidad": 10 } ]
}
```

## Activos

### `GET /api/activos`

Filtros por query string (todos opcionales):
`q` (texto libre), `categoria`, `ubicacion`, `custodio`, `marca`, `estado`,
`limite` (default 200), `offset`.

```json
{ "total": 57, "activos": [ { "id": 1, "descripcion": "...", "codigo": null,
  "marca": "...", "modelo": "...", "valor_cup": null, "valor_usd": 550,
  "categoria": "Aparatos y equipos técnicos especiales",
  "sucursal": "Camagüey", "ubicacion": "ECONOMIA", "custodio": "...",
  "estado": "ACTIVO", "fecha_adquisicion": "19-6-26", "comentarios": null } ] }
```

### `GET /api/activos/:id`

Detalle de un activo.

### `GET /api/activos/export`

Exporta el inventario (con los mismos filtros de `GET /api/activos`) a un fichero
Excel `.xlsx` con el **mismo formato que el original** `Control de AFT cmg rev01.xlsx`:

- Hoja **`Activos`**: columnas `Codigo, Descripcion, Marca, Modelo, Valor CUP,
  Categoria, Sucursal, Fecha de Adquisicion, Ubicación, Custodio, Valor USD,
  Comentarios` (mismos anchos y estilos; sin relleno en cabecera; gridlines off).
- Hoja **`Categoria`**: `Categoria, Ejemplos` desde el catálogo.
- Nombre de fichero: `Control de AFT cmg-YYYY-MM-DD.xlsx`.
- Devuelve el binario, no JSON.

### `GET /api/activos/export/pdf`

Exporta el inventario (mismos filtros que `GET /api/activos`) a un PDF **con el
mismo formato que la hoja original** `20260923-0849.pdf` (*Hoja para Realizar
el Conteo Físico*):

- Cabecera: Organismo / Entidad / Reeup / Unidad, título centrado, Período,
  Conteo, Estado, logo EXBER y «Generado por» (usuario autenticado).
- Columnas: `No. Invent.`, `Descripción`, `Existe`, `Falta` (líneas en blanco
  para marcar a mano).
- Filas agrupadas por **Área** (`ubicacion_id - nombre`).
- Pie con firmas: Responsable del Conteo Físico y Responsable del Área.
- Parámetros de cabecera opcionales por query: `organismo`, `entidad`, `reeup`,
  `unidad`, `conteo`, `periodo`, `estado`, `generadoPor`.
- Nombre de fichero: `Conteo-fisico-YYYY-MM-DD.pdf`.
- Devuelve el binario, no JSON.

### `GET /api/activos/:id/movimientos`

Historial de movimientos de un activo (más recientes primero):
`movimientos: [{ id, tipo, ubicacion_origen, ubicacion_destino, custodio_origen,
custodio_destino, estado_origen, estado_destino, comentario, usuario_id,
created_at, activo_id }]`.

`tipo` ∈ `CREADO | TRASLADO_UBICACION | CAMBIO_CUSTODIO | CAMBIAR_ESTADO`.

### `GET /api/movimientos`

Historial global de movimientos. Filtros: `activo_id`, `q` (por descripción o
código del activo), `limit` (default 500).

### `POST /api/activos`

Cuerpo (solo `descripcion` es obligatorio):
```json
{
  "codigo": null, "descripcion": "LAPTOP ACER", "modelo": "ASPIRE 315",
  "marca_id": 4, "valor_cup": null, "valor_usd": 550,
  "categoria_id": 8, "sucursal_id": 1, "fecha_adquisicion": "19-6-26",
  "ubicacion_id": 4, "custodio_id": 7, "estado": "ACTIVO", "comentarios": null
}
```
Devuelve el activo creado con `201`.

`sucursal_id` se **fuerza al de la propia sucursal** si el usuario no es de los
roles globales; si su sucursal no tiene datos en el sistema → `403`.

### `PUT /api/activos/:id`

Actualiza solo los campos presentes en el cuerpo.

Un usuario de una sucursal no puede mover el activo a otra (`403`), ni ver ni
editar activos de otra sucursal (`404`).

### `DELETE /api/activos/:id`

Elimina (solo rol `admin`). Devuelve `{ "ok": true }`.

## Admin (usuarios) — solo rol `admin`

- `GET /api/admin/users`
- `POST /api/admin/users`
  `{ "username", "password", "nombre?", "rol?", "sucursal?" }`
  (`rol`: `admin` | `usuario`; `sucursal`: código de las ocho, por defecto
  `CAM`; un código que no sea de las ocho → `400`)
- `PUT /api/admin/users/:id`
  Campos parciales: `nombre`, `rol`, `activo` (bool), `password`, `sucursal`.

`GET /api/admin/users` devuelve además `email`, `sucursal` y `rol_accesos`.

## Admin (responsables / custodios) — solo rol `admin`

- `GET /api/admin/custodios` → `[{ id, nombre, activos }]` (conteo de activos asignados)
- `POST /api/admin/custodios` → `{ "nombre": "..." }` → `201` con `{ id, nombre, activos: 0 }`
- `PUT /api/admin/custodios/:id` → `{ "nombre": "..." }` (renombrar)
- `DELETE /api/admin/custodios/:id` → `{ "ok": true }`; `400` si tiene activos asignados

Nombres duplicados → `400` "Ya existe un responsable con ese nombre".

## Health

- `GET /health` → `{ "ok": true, "servicio": "aft-cmg-api" }` (no requiere token).

## Códigos de error habituales

| Código | Significado |
|---|---|
| 401 | Token ausente/inválido o credenciales incorrectas |
| 403 | Requiere rol administrador, usuario desactivado, sucursal sin datos o intento de escribir en otra sucursal |
| 400 | Faltan campos o datos inválidos (incluida una `sucursal` que no es de las ocho) |
| 404 | Recurso no encontrado (también cuando el activo es de otra sucursal) |
| 500 | Error interno (mensaje con el motivo) |