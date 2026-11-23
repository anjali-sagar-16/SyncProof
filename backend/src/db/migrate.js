const fs = require('fs');
const path = require('path');
const { getDb, close } = require('../config/db');

async function runMigration() {
  const isReset = process.argv.includes('--reset');
  console.log(`[Migration] Starting database migration (reset mode: ${isReset})...`);

  const db = await getDb();
  console.log(`[Migration] Database connection active using provider: ${db.clientType}`);

  try {
    if (isReset) {
      console.log('[Migration] Dropping existing tables in dependency order...');
      await db.exec(`
        DROP TABLE IF EXISTS inspection_audit_logs CASCADE;
        DROP TABLE IF EXISTS inspection_conflicts CASCADE;
        DROP TABLE IF EXISTS sync_mutations CASCADE;
        DROP TABLE IF EXISTS inspections CASCADE;
        DROP TABLE IF EXISTS equipment CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
      `);
      console.log('[Migration] Prior tables dropped successfully.');
    }

    const schemaPath = path.resolve(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('[Migration] Executing schema.sql DDL migration script...');
    await db.exec(schemaSql);

    console.log('[Migration] Migration completed successfully! All tables and indexes are ready.');
  } catch (error) {
    console.error('[Migration] Migration failed with error:', error);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
