# --- Etapa 1: construir el frontend (Vue + Vite) ---
FROM node:22-bookworm-slim AS build-fe
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# --- Etapa 2: imagen final: API Express + frontend servido estático ---
FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend ./backend
COPY --from=build-fe /app/frontend/dist ./frontend/dist
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]