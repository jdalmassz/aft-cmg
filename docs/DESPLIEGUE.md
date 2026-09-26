# Despliegue en Dokploy (Proyecto Procovar Camagüey)

La instancia Dokploy está en la nota de Obsidian `projects/procovar-camaguey.md`.

Se despliegan **dos servicios** dentro del mismo proyecto en Dokploy:

| Servicio | Imagen / Origen | Puerto | Rol |
|---|---|---|---|
| `aft-cmg-db` | `postgres:16-alpine` (servicio BD) | 5432 (interno) | Base de datos |
| `aft-cmg-app` | Dockerfile del repo | 8080 (público) | API + frontend |

## Servicio 1 — PostgreSQL (`aft-cmg-db`)

1. Nuevo **Base de datos** en Dokploy → PostgreSQL:
   - **Nombre:** `aft-cmg-db`
   - **Versión:** 16
   - **Base de datos:** `aft_cmg`
   - **User / Password:** el que quieras (ej. `aft` / una clave fuerte)
   - Guarda el **nombre del servicio interno** que genera Dokploy (ej.
     `aft-cmg-db-xyzab`). Se necesitará como host en la app.

## Servicio 2 — Aplicación (`aft-cmg-app`)

1. Nuevo **Aplicación** → origen **GitHub** → repo `jdalmassz/aft-cmg`,
   rama `main`, **Build: Dockerfile** (está en la raíz).
2. En **Avanzado → Variables de entorno**:

```
DATABASE_URL=postgres://aft:TU_CLAVE@aft-cmg-db-xyzab:5432/aft_cmg
JWT_SECRET=<generar uno largo, ej. openssl rand -hex 32>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<contraseña inicial del admin>
PORT=8080
# El proxy de Dokploy termina el https: sin esto el app ve http y el callback
# de Accesos saldría con http:// (allowedCallbackUrls sólo acepta https).
TRUST_PROXY=1

# Tasa de cambio para el total en CUP del dashboard: los activos que sólo
# tienen valor en dólares se multiplican por esta tasa. Cambia cada semana, así
# que aquí se cambia sin tocar datos. Opcional: sin ella se usa 675.
TASA_CAMBIO=675

# Accesos (SSO) — https://auth.procovar.cloud
# AFT_AUTH_SIGNING_KEY: la clave hex que Jose te dé (procovar/.secretos).
# Se lee en HEXADECIMAL, no como texto plano. Sin ella, la ida a Accesos no se
# puede firmar y /login se queda en ?sso=nodisponible (entrada de reserva:
# POST /auth/login con el admin).
AFT_AUTH_URL=https://auth.procovar.cloud
AFT_AUTH_CLIENT_ID=aft
AFT_AUTH_SIGNING_KEY=<clave-hex>
```

3. En **Puertos**: publicar `8080`.
4. Desplegar.

## Accesos (SSO) — lo que hay que pedir antes

En Accesos **no se registra nada desde esta aplicación: sólo se consume su API**.
El alta de la aplicación la hace Jose, y de ahí salen dos cosas:

| Qué pedir | Para qué |
|---|---|
| `clientId` | El nombre de la app; va en `AFT_AUTH_CLIENT_ID` (aquí, `aft`) |
| `signingKey` | La clave hex; va en `AFT_AUTH_SIGNING_KEY`. **No va en el repo** |
| `allowedCallbackUrls` | Tiene que incluir, **letra a letra**: `https://aft.procovar.cloud/api/auth/sso/callback` y para local `http://localhost:8080/api/auth/sso/callback` (o `http://localhost:5173/api/auth/sso/callback` si trabajas con Vite) |

Sin la clave, la app no falla: entra por `/?sso=nodisponible` y la pantalla
avisa. El endpoint `/auth/login` (login local) sigue ahí por si hay que volver
atrás, pero ya no tiene pantalla. Con la clave puesta, el paso 1 del documento
(`callback-token`) tiene que contestar `200`; un `401` casi siempre es la clave
leída como texto en vez de hexadecimal, o el reloj del servidor corrido.

## Notas

- El contenedor aplica el esquema y seed automáticamente la primera vez que
  arranca (idempotente, controlado por la tabla `schema_seeds`).
- El frontend lo sirve el propio Node junto a la API (un solo origen, sin nginx).
- Para actualizar: `git push` en la rama `main` y re-desplegar en el panel.
- Si algún día se separa frontend/nginx, la plantilla está en el patrón de
  `asignacion-vendedores/frontend/nginx.conf.template`.

## Probar en local (equivalente Docker)

```bash
docker compose up --build
# app en http://localhost:8080
```