require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const authSso = require('./auth-sso');
const authLogout = require('./auth-logout');
const users = require('./users');
const usersAdmin = require('./users-admin');
const activos = require('./activos');
const movimientos = require('./movimientos');
const custodios = require('./custodios');
const areas = require('./areas');
const { exportActivosPdf } = require('./export-pdf');

function cors() {
  return (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

async function bootstrap() {
  await db.connect();
  await db.waitForDb();
  await db.initSchema();
  await users.ensureAdminUser();

  const app = express();

  // Detrás del proxy de Dokploy todo llega en http. Sin confiar en
  // X-Forwarded-Proto, el callback de Accesos saldría con http:// (y
  // allowedCallbackUrls exige https) y la cookie no marcaría `secure`.
  // TRUST_PROXY: número de saltos (por defecto 1), o una lista de IPs.
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === undefined ? 1 : /^\d+$/.test(tp) ? Number(tp) : tp);

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(require('cookie-parser')());

  app.get('/health', (req, res) => res.json({ ok: true, servicio: 'aft-cmg-api' }));

  // Accesos (SSO): la puerta de entrada. Van sin middleware de auth.
  // El botón de entrada es un enlace (<a href>), así que entra por GET; se
  // acepta POST por si se llama desde el servidor, como en delivery.
  // El login local queda como respaldo: si la clave no está configurada,
  // /entrar redirige a ?sso=nodisponible y el usuario entra por abajo.
  app.get('/api/auth/entrar', authSso.entrar);
  app.post('/api/auth/entrar', authSso.entrar);
  app.get('/api/auth/sso/callback', authSso.callback);
  // Sin token: lo único que hace es borrar la cookie httpOnly, y tiene que
  // funcionar también cuando la sesión ya expiró (si no, la cookie se queda).
  app.post('/api/auth/logout', authLogout.logout);
  app.post('/auth/login', users.login);

  const api = express.Router();
  api.use(auth.authMiddleware);

  api.get('/me', users.me);
  api.post('/me/password', usersAdmin.changePassword);

  api.get('/catalogo', activos.catalogo);
  api.get('/dashboard', activos.dashboard);

  api.get('/activos', activos.listActivos);
  api.get('/activos/export', activos.exportActivos);
  api.get('/activos/export/pdf', exportActivosPdf);
  api.get('/activos/:id', activos.getActivo);
  api.get('/activos/:id/movimientos', movimientos.movimientosByActivo);
  api.post('/activos', activos.createActivo);
  api.put('/activos/:id', activos.updateActivo);
  // Borrar es destructivo sobre el inventario de la empresa: sólo admin (la
  // API ya lo documentaba así; con los siete roles de Accesos entrando ya no
  // es un detalle).
  api.delete('/activos/:id', auth.adminOnly, activos.deleteActivo);

  /**
   * ÚTILES Y HERRAMIENTAS: el otro inventario, por su propia puerta.
   *
   * Comparten tabla con los activos fijos (ver schema.sql), pero no comparten ruta: el
   * tipo lo pone ESTA lista de rutas y no quien llama, así que una pantalla de útiles no
   * puede leer ni escribir activos fijos ni por error ni a propósito.
   */
  const soloUtiles = (req, res, next) => { req.tipoActivo = 'UTIL'; next(); };

  api.get('/utiles', soloUtiles, activos.listActivos);
  api.get('/utiles/export', soloUtiles, activos.exportActivos);
  api.get('/utiles/export/pdf', soloUtiles, exportActivosPdf);
  api.get('/utiles/:id', soloUtiles, activos.getActivo);
  api.get('/utiles/:id/movimientos', movimientos.movimientosByActivo);
  api.post('/utiles', soloUtiles, activos.createActivo);
  api.put('/utiles/:id', soloUtiles, activos.updateActivo);
  // Mismo criterio que en /activos: borrar es destructivo sobre el inventario.
  api.delete('/utiles/:id', soloUtiles, auth.adminOnly, activos.deleteActivo);

  api.get('/movimientos', movimientos.listMovimientos);

  const adm = express.Router();
  adm.use(auth.adminOnly);
  adm.get('/users', usersAdmin.listUsers);
  adm.post('/users', usersAdmin.createUser);
  adm.put('/users/:id', usersAdmin.updateUser);

  adm.get('/custodios', custodios.listCustodios);
  adm.post('/custodios', custodios.createCustodio);
  adm.put('/custodios/:id', custodios.updateCustodio);
  adm.delete('/custodios/:id', custodios.deleteCustodio);

  adm.get('/areas', areas.listAreas);
  adm.post('/areas', areas.createArea);
  adm.put('/areas/:id', areas.updateArea);
  adm.delete('/areas/:id', areas.deleteArea);
  adm.post('/ubicaciones', areas.createUbicacion);
  adm.put('/ubicaciones/:id', areas.updateUbicacion);
  adm.delete('/ubicaciones/:id', areas.deleteUbicacion);

  app.use('/api', api);
  app.use('/api/admin', adm);

  app.use((err, req, res, next) => {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Error interno' });
  });

  const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(dist)) {
    app.use('/assets', express.static(path.join(dist, 'assets')));
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method)) return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/health')) return next();
      const index = path.join(dist, 'index.html');
      if (fs.existsSync(index)) return res.sendFile(index);
      next();
    });
  }

  const port = process.env.PORT || 8080;
  app.listen(port, () => console.log(`aft-cmg API escuchando en el puerto ${port}`));

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      db.getPool().end().finally(() => process.exit(0));
    });
  }
}

bootstrap().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});