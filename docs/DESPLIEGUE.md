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
```

3. En **Puertos**: publicar `8080`.
4. Desplegar.

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