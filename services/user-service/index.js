/**
 * AquaSense – user-service  (PostgreSQL / Aurora)
 * Port: 8081 | Table: users
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const pool     = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8081;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) { console.error('[user-service] FATAL: JWT_SECRET env var not set'); process.exit(1); }

app.use(helmet()); app.use(cors()); app.use(express.json()); app.use(morgan('combined'));

// ── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(403).json({ error: 'Invalid or expired token' }); }
}

// ── Routes ───────────────────────────────────────────────────

app.get('/health', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ status:'healthy', service:'user-service', db:'connected', uptime: process.uptime() }); }
  catch { res.status(503).json({ status:'unhealthy', service:'user-service', db:'disconnected' }); }
});

app.get('/', (_, res) => res.json({ service:'user-service', version:'1.0.0' }));

// Register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role = 'residential' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, created_at`,
      [name, email, hash, role]
    );
    const user  = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ message: 'Registered', user, token });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash: _, ...safe } = user;
    res.json({ message: 'Login successful', user: safe, token, expiresIn: '24h' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Profile
app.get('/api/users/profile', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at, updated_at FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    // Attach meters
    const { rows: meters } = await pool.query(
      'SELECT id, type, location, status, mqtt_topic FROM meters WHERE user_id=$1', [req.user.id]);
    res.json({ user: { ...rows[0], meters } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Update profile
app.put('/api/users/profile', auth, async (req, res) => {
  const { name, password } = req.body;
  try {
    let q, params;
    if (name && password) {
      const hash = await bcrypt.hash(password, 10);
      q = 'UPDATE users SET name=$1, password_hash=$2 WHERE id=$3 RETURNING id,name,email,role,updated_at';
      params = [name, hash, req.user.id];
    } else if (name) {
      q = 'UPDATE users SET name=$1 WHERE id=$2 RETURNING id,name,email,role,updated_at';
      params = [name, req.user.id];
    } else {
      return res.status(400).json({ error: 'Provide name or password to update' });
    }
    const { rows } = await pool.query(q, params);
    res.json({ message: 'Profile updated', user: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// All users (admin)
app.get('/api/users/all', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { rows } = await pool.query('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC');
    res.json({ count: rows.length, users: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Verify token
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try { res.json({ valid: true, payload: jwt.verify(token, JWT_SECRET) }); }
  catch { res.json({ valid: false }); }
});

const server = app.listen(PORT, () => console.log(`[user-service] :${PORT}`));

function gracefulShutdown(signal) {
  console.log(`[user-service] ${signal} received – shutting down gracefully`);
  server.close(() => pool.end(() => { console.log('[user-service] shutdown complete'); process.exit(0); }));
  setTimeout(() => process.exit(1), 10000); // force kill after 10s
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
module.exports = app;
