# AGENTS.md — Reglas para agentes de IA

Este archivo es para cualquier IA (opencode, Claude, Cursor, etc.) que trabaje en
este repositorio.

## Fuente de datos (SOLO LECTURA)

- **`Control de AFT cmg rev01.xlsx`** (en `~/Downloads`): es la fuente original de
  los activos. **No se modifica.** Si cambia, se regenera `backend/src/data/seed_activos.sql`
  y se aplica como revisión.
- La base de datos `camaguey` (MariaDB de producción, `192.168.1.217`) **NO se usa**
  ni se toca desde este proyecto.

## Permitido

- Modificar el código (`backend/**`, `frontend/**`), esquema, seeds y docs.
- Leer/consultar (SELECT) las fuentes SOLO LECTURA (`camaguey`, PEDIDO, Ventra) para validar.
- **Leer y escribir** en el PostgreSQL `aft_cmg` (BD propia del sistema AFT).
- Ejecutar las rutas de prueba y builds (ver README).

## Prohibido

- NO tocar ningún otro proyecto del usuario (solo se trabaja el proyecto
  **Procovar Camagüey / aft-cmg**).
- **NO tocar la MariaDB `camaguey` de producción** (`192.168.1.217`), ni la **API
  PEDIDO**, ni **Ventra/AXIS**: son SOLO LECTURA. Cualquier escritura ahí es
  destrucción de datos de la empresa → jamás INSERT/UPDATE/DELETE/ALTER/DROP.
- NO subir a git el `.env` ni el API key de Dokploy que vive en Obsidian.
- NO borrar el Excel original (`Control de AFT cmg rev01.xlsx`).
- NO sobreescribir datos de activos sin consultar: el inventario es la verdad de
  la empresa; un cambio destructivo debe pedir confirmación.

## Permitido

- Leer/consultar (SELECT) las fuentes SOLO LECTURA para validar o entender.
- **Leer y escribir** en el PostgreSQL `aft_cmg` (BD propia del sistema).