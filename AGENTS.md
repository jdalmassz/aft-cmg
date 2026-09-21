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
- Leer/consultar PostgreSQL del sistema AFT (solo lectura) para validar.
- Ejecutar las rutas de prueba y builds (ver README).

## Prohibido

- NO tocar ningún otro proyecto del usuario (solo se trabaja el proyecto
  **Procovar Camagüey / aft-cmg**).
- NO subir a git el `.env` ni el API key de Dokploy que vive en Obsidian.
- NO borrar el Excel original.
- NO sobreescribir datos de activos sin consultar: el inventario es la verdad de
  la empresa; un cambio destructivo debe pedir confirmación.