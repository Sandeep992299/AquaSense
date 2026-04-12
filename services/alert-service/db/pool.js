/**
 * db/pool.js  --  PostgreSQL connection pool (self-contained per-service)
 * pg is resolved from this service's own node_modules — no shared-pool shim.
 */
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'aquasense_db',
  user:     process.env.DB_USER     || 'aqua_admin',
  password: process.env.DB_PASSWORD,          // no default -- must be set in prod
  ssl:      process.env.DB_SSL === 'true'
              ? { rejectUnauthorized: false }  // required for Aurora
              : false,
  max:                     parseInt(process.env.DB_POOL_MAX         || '10'),
  idleTimeoutMillis:       parseInt(process.env.DB_IDLE_MS          || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS  || '5000'),
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// Attempt connection on startup (non-fatal if DB is not present locally)
pool.connect()
  .then(client => {
    console.log('[db] Connected to PostgreSQL at ' + (process.env.DB_HOST || 'localhost') + ':' + (process.env.DB_PORT || 5432));
    client.release();
  })
  .catch(err => {
    console.error('[db] Connection failed:', err.message);
    console.error('[db] Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD to connect');
  });

module.exports = pool;
