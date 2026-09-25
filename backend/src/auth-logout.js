// Cierre de sesión: borra la cookie httpOnly del SSO y la del login local.
// El frontend no puede borrarla con JS (es httpOnly), así que lo hace el servidor.

const sso = require('./procovar-auth');

function logout(req, res) {
  res.clearCookie(sso.SSO_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
  res.clearCookie('aft_token', { path: '/' });
  return res.json({ ok: true });
}

module.exports = { logout };