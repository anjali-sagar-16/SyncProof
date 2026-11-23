const fs = require('fs');
const path = require('path');
const config = require('./env');

let activeClientType = null;
let poolInstance = null;
let pgliteInstance = null;

/**
 * Initializes and returns the active database connection.
 * Auto-detects whether external PostgreSQL (Docker/service) is reachable,
 * falling back gracefully to embedded PostgreSQL (PGlite) if not.
 */
async function getDb() {
  if (activeClientType) {
    return { clientType: activeClientType, query, exec, withTransaction, close };
  }

  // Explicit PGlite mode
  if (config.dbClient === 'pglite') {
    await initPglite();
    return { clientType: activeClientType, query, exec, withTransaction, close };
  }

  // Explicit PG pool mode
  if (config.dbClient === 'pg') {
    await initPgPool();
    return { clientType: activeClientType, query, exec, withTransaction, close };
  }

  // Auto mode: probe standard PostgreSQL port 5432 first
  try {
    const { Pool } = require('pg');
    const testPool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl,
      connectionTimeoutMillis: 1500,
    });

    const client = await testPool.connect();
    await client.query('SELECT 1');
    client.release();

    poolInstance = testPool;
    activeClientType = 'pg';
    console.log(`[DB] Connected to PostgreSQL on ${config.db.host}:${config.db.port}/${config.db.database}`);
    return { clientType: activeClientType, query, exec, withTransaction, close };
  } catch (err) {
    console.log(`[DB] External PostgreSQL on port ${config.db.port} not reachable (${err.message}).`);
    console.log(`[DB] Activating embedded PostgreSQL engine (PGlite) with persistent disk storage.`);
    await initPglite();
    return { clientType: activeClientType, query, exec, withTransaction, close };
  }
}

async function initPgPool() {
  const { Pool } = require('pg');
  poolInstance = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl,
  });
  const client = await poolInstance.connect();
  client.release();
  activeClientType = 'pg';
  console.log(`[DB] Connected to PostgreSQL via pg.Pool`);
}

async function initPglite() {
  const { PGlite } = require('@electric-sql/pglite');
  const os = require('os');
  let dataDir = config.db.pgliteDataDir;
  
  // Ensure storage directory exists
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err) {
    const fallbackDir = path.join(os.tmpdir(), 'syncproof_pgdata');
    console.warn(`[DB] Could not initialize storage directory at ${dataDir} (${err.message}). Falling back to: ${fallbackDir}`);
    dataDir = fallbackDir;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  pgliteInstance = new PGlite(dataDir);
  await pgliteInstance.waitReady;
  activeClientType = 'pglite';
  console.log(`[DB] Initialized embedded PostgreSQL (PGlite) storage at: ${dataDir}`);
}

/**
 * Executes a parameterized SQL query against the active database.
 */
async function query(text, params = []) {
  if (!activeClientType) {
    await getDb();
  }

  if (activeClientType === 'pg') {
    const res = await poolInstance.query(text, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount,
      fields: res.fields,
    };
  } else {
    const res = await pgliteInstance.query(text, params);
    return {
      rows: res.rows,
      rowCount: res.affectedRows ?? res.rows.length,
      fields: res.fields,
    };
  }
}

/**
 * Executes a callback within a managed database transaction.
 */
async function withTransaction(callback) {
  if (!activeClientType) {
    await getDb();
  }

  if (activeClientType === 'pg') {
    const client = await poolInstance.connect();
    try {
      await client.query('BEGIN');
      const transactionQuery = async (text, params) => {
        const res = await client.query(text, params);
        return { rows: res.rows, rowCount: res.rowCount };
      };
      const result = await callback({ query: transactionQuery });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    return await pgliteInstance.transaction(async (tx) => {
      const transactionQuery = async (text, params) => {
        const res = await tx.query(text, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      };
      return await callback({ query: transactionQuery });
    });
  }
}

/**
 * Executes a multi-statement SQL script (e.g. schema migrations).
 */
async function exec(sql) {
  if (!activeClientType) {
    await getDb();
  }

  if (activeClientType === 'pg') {
    return await poolInstance.query(sql);
  } else {
    return await pgliteInstance.exec(sql);
  }
}

/**
 * Closes the active database connection.
 */
async function close() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
  if (pgliteInstance) {
    await pgliteInstance.close();
    pgliteInstance = null;
  }
  activeClientType = null;
}

module.exports = {
  getDb,
  query,
  exec,
  withTransaction,
  close,
};
