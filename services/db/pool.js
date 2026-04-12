/**
 * Shared PostgreSQL pool – used by all 4 services
 * Reads connection from environment variables only.
 * Locally: connects to docker-compose postgres container
 * On AWS:  connects to Aurora PostgreSQL (same driver, same code)
 */
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'aquasense_db',
  user:     process.env.DB_USER     || 'aqua_admin',
  password: process.env.DB_PASSWORD,          // never has a default
  ssl:      process.env.DB_SSL === 'true'
              ? { rejectUnauthorized: false }  // Aurora requires SSL
              : false,
  max:               parseInt(process.env.DB_POOL_MAX  || '10'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_MS   || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS || '5000'),
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// Test connection on startup
pool.connect()
  .then(client => {
    console.log(`[db] Connected to PostgreSQL at ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
    client.release();
  })
  .catch(err => {
    console.error('[db] Connection failed:', err.message);
    console.error('[db] Check DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD env vars');
  });

module.exports = pool;
