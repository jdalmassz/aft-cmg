# API — Sistema AFT Camagüey

- **Producción**: `https://aft.procovar.cloud`
- **Local**: `http://localhost:8080`

Formato de respuesta: JSON. Errores: `{ "error": "mensaje" }` con el código HTTP
correspondiente.

## Autenticación

Casi todas las rutas exigen un token JWT en la cabecera:

```
Authorization: Bearer <token>
```

### `POST /auth/login`

Cuerpo:
```json
{ "username": "admin", "password": "admin123" }
```

Respuesta `200`:
```json
{
  "token": "<jwt>",
  "user": { "id": "...", "username": "admin", "nombre": "Administrador", "rol": "admin", "activo": true }
}
```

### `GET /api/me`

Devuelve el usuario autenticado.

### `POST /api/me/password`

Cambia la propia contraseña.
```json
{ "current": "admin123", "nuevo": "nueva-clave" }
```

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

### `PUT /api/activos/:id`

Actualiza solo los campos presentes en el cuerpo.

### `DELETE /api/activos/:id`

Elimina (solo rol `admin`). Devuelve `{ "ok": true }`.

## Admin (usuarios) — solo rol `admin`

- `GET /api/admin/users`
- `POST /api/admin/users`
  `{ "username", "password", "nombre?", "rol?" }` (`rol`: `admin` | `usuario`)
- `PUT /api/admin/users/:id`
  Campos parciales: `nombre`, `rol`, `activo` (bool), `password`.

## Health

- `GET /health` → `{ "ok": true, "servicio": "aft-cmg-api" }` (no requiere token).

## Códigos de error habituales

| Código | Significado |
|---|---|
| 401 | Token ausente/inválido o credenciales incorrectas |
| 403 | Requiere rol administrador o usuario desactivado |
| 400 | Faltan campos o datos inválidos |
| 404 | Recurso no encontrado |
| 500 | Error interno (mensaje con el motivo) |