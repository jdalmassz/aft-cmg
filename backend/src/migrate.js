require('dotenv').config();
const db = require('./db');

async function main() {
  await db.connect();
  await db.initSchema();
  console.log('Esquema y seeds aplicados correctamente.');
  await db.getPool().end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});