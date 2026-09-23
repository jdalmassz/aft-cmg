const db = require('./db');

async function listCustodios(req, res, next) {
  try {
    const r = await db.getPool().query(`
      SELECT cu.id, cu.nombre, COUNT(a.id)::int AS activos
      FROM custodios cu
      LEFT JOIN activos a ON a.custodio_id = cu.id
      GROUP BY cu.id, cu.nombre
      ORDER BY cu.nombre`);
    return res.json(r.rows);
  } catch (e) { next(e); }
}

async function createCustodio(req, res, next) {
  try {
    const nombre = (req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'INSERT INTO custodios (nombre) VALUES ($1) RETURNING id, nombre',
      [nombre]
    );
    return res.status(201).json({ ...r.rows[0], activos: 0 });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un responsable con ese nombre' });
    next(e);
  }
}

async function updateCustodio(req, res, next) {
  try {
    const nombre = (req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await db.getPool().query(
      'UPDATE custodios SET nombre = $1 WHERE id = $2 RETURNING id, nombre',
      [nombre, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Responsable no encontrado' });
    return res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un responsable con ese nombre' });
    next(e);
  }
}

async function deleteCustodio(req, res, next) {
  try {
    const u = await db.getPool().query(
      'SELECT COUNT(*)::int AS n FROM activos WHERE custodio_id = $1',
      [req.params.id]
    );
    if (u.rows[0].n > 0) {
      return res.status(400).json({ error: `No se puede eliminar: tiene ${u.rows[0].n} activo(s) asignados` });
    }
    const r = await db.getPool().query('DELETE FROM custodios WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Responsable no encontrado' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listCustodios, createCustodio, updateCustodio, deleteCustodio };
