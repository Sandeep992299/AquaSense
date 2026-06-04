/**
 * AquaSense – user-service  (PostgreSQL / Aurora)
 * Port: 8081 | Table: users
 * Rich structured CloudWatch logging on all routes
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const helmet   = require('helmet');
const pool     = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8081;
const JWT_SECRET = process.env.JWT_SECRET;
const SVC = 'user-service';

if (!JWT_SECRET) {
  console.error(JSON.stringify({ svc: SVC, level: 'FATAL', msg: 'JWT_SECRET env var not set', ts: new Date().toISOString() }));
  process.exit(1);
}

/* ─── Structured Logger ──────────────────────────────────────── */
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts:      new Date().toISOString(),
    svc:     SVC,
    level,
    msg,
    env:     process.env.NODE_ENV || 'production',
    ...extra
  }));
}

/* ─── Request Logger Middleware ──────────────────────────────── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    log(level, `${req.method} ${req.path}`, {
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      duration_ms: ms,
      ip:         req.ip,
      ua:         req.headers['user-agent']?.substring(0, 80),
    });
  });
  next();
});

app.use(helmet());
app.use(cors());
app.use(express.json());

/* ─── Auth Middleware ────────────────────────────────────────── */
function auth(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) { log('WARN', 'Auth failed: no token', { path: req.path }); return res.status(401).json({ error: 'Access token required' }); }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    log('WARN', 'Auth failed: invalid token', { path: req.path, err: e.message });
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/* ─── Routes ─────────────────────────────────────────────────── */

app.get('/health', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT version(), NOW() AS db_time');
    log('INFO', 'Health check OK', { db: 'connected', pg_version: rows[0].version.split(' ')[1], uptime_s: Math.round(process.uptime()) });
    res.json({ status: 'healthy', service: SVC, db: 'connected', uptime: process.uptime(), version: process.env.IMAGE_TAG || 'local' });
  } catch (e) {
    log('ERROR', 'Health check FAILED', { err: e.message });
    res.status(503).json({ status: 'unhealthy', service: SVC, db: 'disconnected' });
  }
});

app.get('/', (_, res) => res.json({ service: SVC, version: '2.0.0' }));

/* Register */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role = 'residential' } = req.body;
  if (!name || !email || !password) {
    log('WARN', 'Register: missing fields', { email });
    return res.status(400).json({ error: 'name, email, password required' });
  }
  try {
    log('INFO', 'Register attempt', { email, role });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, created_at`,
      [name, email, hash, role]
    );
    const user  = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    log('INFO', 'Register SUCCESS', { userId: user.id, email, role });
    res.status(201).json({ message: 'Registered', user, token });
  } catch (e) {
    if (e.code === '23505') {
      log('WARN', 'Register DUPLICATE email', { email });
      return res.status(409).json({ error: 'Email already registered' });
    }
    log('ERROR', 'Register FAILED', { email, err: e.message, stack: e.stack?.split('\n')[1] });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Login */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    log('WARN', 'Login: missing credentials');
    return res.status(400).json({ error: 'email and password required' });
  }
  try {
    log('INFO', 'Login attempt', { email });
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) {
      log('WARN', 'Login FAILED: user not found', { email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      log('WARN', 'Login FAILED: wrong password', { email, userId: user.id });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash: _, ...safe } = user;
    log('INFO', 'Login SUCCESS', { userId: user.id, email, role: user.role });
    res.json({ message: 'Login successful', user: safe, token, expiresIn: '24h' });
  } catch (e) {
    log('ERROR', 'Login FAILED: server error', { email, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Profile GET */
app.get('/api/users/profile', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at, updated_at FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) { log('WARN', 'Profile: user not found', { userId: req.user.id }); return res.status(404).json({ error: 'User not found' }); }
    const { rows: meters } = await pool.query(
      'SELECT id, type, location, status, mqtt_topic FROM meters WHERE user_id=$1', [req.user.id]);
    log('INFO', 'Profile fetched', { userId: req.user.id, metersCount: meters.length });
    res.json({ user: { ...rows[0], meters } });
  } catch (e) {
    log('ERROR', 'Profile FAILED', { userId: req.user.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Profile UPDATE */
app.put('/api/users/profile', auth, async (req, res) => {
  const { name, password } = req.body;
  try {
    let q, params;
    if (name && password) {
      const hash = await bcrypt.hash(password, 10);
      q = 'UPDATE users SET name=$1, password_hash=$2, updated_at=NOW() WHERE id=$3 RETURNING id,name,email,role,updated_at';
      params = [name, hash, req.user.id];
    } else if (name) {
      q = 'UPDATE users SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING id,name,email,role,updated_at';
      params = [name, req.user.id];
    } else {
      return res.status(400).json({ error: 'Provide name or password to update' });
    }
    const { rows } = await pool.query(q, params);
    log('INFO', 'Profile updated', { userId: req.user.id, updatedFields: Object.keys(req.body) });
    res.json({ message: 'Profile updated', user: rows[0] });
  } catch (e) {
    log('ERROR', 'Profile update FAILED', { userId: req.user.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* All users (admin) */
app.get('/api/users/all', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    log('WARN', 'Unauthorized access to /api/users/all', { userId: req.user.id, role: req.user.role });
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const { rows } = await pool.query('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC');
    log('INFO', 'Admin: all users fetched', { count: rows.length, requestedBy: req.user.id });
    res.json({ count: rows.length, users: rows });
  } catch (e) {
    log('ERROR', 'Admin users list FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Verify token */
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    log('INFO', 'Token verified', { userId: payload.id, exp: new Date(payload.exp * 1000).toISOString() });
    res.json({ valid: true, payload });
  } catch (e) {
    log('WARN', 'Token invalid', { err: e.message });
    res.json({ valid: false });
  }
});

/* ─── Startup ─────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  log('INFO', `Service started on port ${PORT}`, {
    port: PORT,
    node: process.version,
    pid:  process.pid,
    env:  process.env.NODE_ENV || 'production',
  });
});

/* ─── Graceful Shutdown ──────────────────────────────────────── */
function gracefulShutdown(signal) {
  log('INFO', `${signal} received – shutting down gracefully`, { signal });
  server.close(() => pool.end(() => {
    log('INFO', 'Graceful shutdown complete');
    process.exit(0);
  }));
  setTimeout(() => { log('ERROR', 'Forced shutdown after timeout'); process.exit(1); }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (e) => log('ERROR', 'Uncaught exception', { err: e.message, stack: e.stack }));
process.on('unhandledRejection', (r) => log('ERROR', 'Unhandled rejection', { reason: String(r) }));
module.exports = app;
