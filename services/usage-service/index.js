/**
 * AquaSense – usage-service  (PostgreSQL / Aurora)
 * Port: 8083 | Tables: meter_readings, meters
 * Full CRUD: meters + readings
 * Rich structured CloudWatch logging on all routes
 */
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const pool    = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8083;
const SVC  = 'usage-service';

/* ─── Structured Logger ──────────────────────────────────────── */
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts:    new Date().toISOString(),
    svc:   SVC,
    level,
    msg,
    env:   process.env.NODE_ENV || 'production',
    ...extra
  }));
}

/* ─── Request Logger Middleware ──────────────────────────────── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const lvl = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    log(lvl, `${req.method} ${req.path}`, {
      method:      req.method,
      path:        req.path,
      status:      res.statusCode,
      duration_ms: ms,
      ip:          req.ip,
      query:       Object.keys(req.query).length ? req.query : undefined,
    });
  });
  next();
});

app.use(helmet());
app.use(cors());
app.use(express.json());

/* ─── Health ─────────────────────────────────────────────────── */
app.get('/health', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS meter_count FROM meters');
    const { rows: r2 } = await pool.query('SELECT COUNT(*) AS reading_count FROM meter_readings');
    log('INFO', 'Health check OK', {
      db: 'connected', uptime_s: Math.round(process.uptime()),
      meters: +rows[0].meter_count, readings: +r2[0].reading_count
    });
    res.json({ status: 'healthy', service: SVC, db: 'connected', uptime: process.uptime(), version: process.env.IMAGE_TAG || 'local' });
  } catch (e) {
    log('ERROR', 'Health check FAILED', { err: e.message });
    res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
  }
});

app.get('/', (_, res) => res.json({ service: SVC, version: '2.0.0' }));

/* ─── METERS ─────────────────────────────────────────────────── */

/* GET all meters */
app.get('/api/usage/meters', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        u.name AS user_name,
        (SELECT value       FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS latest_value,
        (SELECT unit        FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS unit,
        (SELECT recorded_at FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS last_seen
      FROM meters m JOIN users u ON m.user_id=u.id
      ORDER BY m.registered_at`);
    log('INFO', 'All meters fetched', { count: rows.length });
    res.json({ count: rows.length, meters: rows });
  } catch (e) {
    log('ERROR', 'Fetch all meters FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET meters for a user */
app.get('/api/usage/meters/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        u.name AS user_name,
        (SELECT value       FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS latest_value,
        (SELECT unit        FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS unit,
        (SELECT recorded_at FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS last_seen
      FROM meters m JOIN users u ON m.user_id=u.id
      WHERE m.user_id=$1 ORDER BY m.registered_at`, [req.params.userId]);
    log('INFO', 'User meters fetched', { userId: req.params.userId, count: rows.length });
    res.json({ count: rows.length, meters: rows });
  } catch (e) {
    log('ERROR', 'User meters FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST – Register new meter */
app.post('/api/usage/meters', async (req, res) => {
  const { id, type, location, status, user_id } = req.body;
  if (!id || !type || !user_id) {
    log('WARN', 'Register meter: missing fields', { body: { id, type, user_id } });
    return res.status(400).json({ error: 'id, type, user_id are required' });
  }
  const validTypes  = ['water', 'energy'];
  const validStatus = ['online', 'offline', 'warning'];
  if (!validTypes.includes(type)) {
    log('WARN', 'Register meter: invalid type', { id, type });
    return res.status(400).json({ error: 'type must be water or energy' });
  }
  const mqttTopic = type === 'water' ? 'smartmeter/water/usage' : 'smartmeter/energy/usage';
  try {
    const { rows: [existing] } = await pool.query('SELECT id FROM meters WHERE id=$1', [id]);
    if (existing) {
      log('WARN', 'Register meter: ID already exists', { id });
      return res.status(409).json({ error: 'Meter ID already exists' });
    }
    const { rows: [m] } = await pool.query(
      `INSERT INTO meters (id, user_id, type, location, status, mqtt_topic)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id.toUpperCase(), user_id, type, location || null,
       validStatus.includes(status) ? status : 'online', mqttTopic]
    );
    log('INFO', 'Meter registered', { meterId: m.id, type, location, status: m.status, userId: user_id });
    res.status(201).json({ message: 'Meter registered', meter: m });
  } catch (e) {
    log('ERROR', 'Register meter FAILED', { id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT – Update meter */
app.put('/api/usage/meters/:id', async (req, res) => {
  const { location, status } = req.body;
  const validStatus = ['online', 'offline', 'warning'];
  try {
    const updates = []; const params = [];
    if (location !== undefined) { params.push(location); updates.push(`location=$${params.length}`); }
    if (status && validStatus.includes(status)) { params.push(status); updates.push(`status=$${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows: [m] } = await pool.query(
      `UPDATE meters SET ${updates.join(',')} WHERE id=$${params.length} RETURNING *`, params);
    if (!m) { log('WARN', 'Update meter: not found', { meterId: req.params.id }); return res.status(404).json({ error: 'Meter not found' }); }
    log('INFO', 'Meter updated', { meterId: m.id, changes: req.body });
    res.json({ message: 'Meter updated', meter: m });
  } catch (e) {
    log('ERROR', 'Update meter FAILED', { meterId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE – Remove meter */
app.delete('/api/usage/meters/:id', async (req, res) => {
  try {
    // Count readings that will be cascade-deleted
    const { rows: [cnt] } = await pool.query('SELECT COUNT(*) FROM meter_readings WHERE meter_id=$1', [req.params.id]);
    const { rows: [m] } = await pool.query('DELETE FROM meters WHERE id=$1 RETURNING id', [req.params.id]);
    if (!m) { log('WARN', 'Delete meter: not found', { meterId: req.params.id }); return res.status(404).json({ error: 'Meter not found' }); }
    log('INFO', 'Meter deleted', { meterId: m.id, readingsRemoved: +cnt.count });
    res.json({ message: 'Meter deleted', id: m.id, readingsRemoved: +cnt.count });
  } catch (e) {
    log('ERROR', 'Delete meter FAILED', { meterId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── READINGS ────────────────────────────────────────────────── */

/* GET readings for a meter (paginated) */
app.get('/api/usage/readings/:meterId', async (req, res) => {
  const { page = 1, limit = 48, type } = req.query;
  const offset = (page - 1) * limit;
  try {
    const params = [req.params.meterId, limit, offset];
    let where = 'WHERE meter_id=$1';
    if (type) { where += ' AND type=$4'; params.push(type); }
    const { rows } = await pool.query(
      `SELECT * FROM meter_readings ${where} ORDER BY recorded_at DESC LIMIT $2 OFFSET $3`, params);
    const { rows: [cnt] } = await pool.query(
      `SELECT COUNT(*) FROM meter_readings ${where}`,
      [req.params.meterId, ...(type ? [type] : [])]);
    log('INFO', 'Readings fetched', { meterId: req.params.meterId, count: rows.length, total: +cnt.count, page, limit });
    res.json({ meterId: req.params.meterId, total: +cnt.count, page: +page, data: rows });
  } catch (e) {
    log('ERROR', 'Fetch readings FAILED', { meterId: req.params.meterId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT – Update a reading */
app.put('/api/usage/readings/:id', async (req, res) => {
  const { value, pressure, quality } = req.body;
  const validQuality = ['normal', 'anomaly'];
  try {
    const updates = []; const params = [];
    if (value    !== undefined)            { params.push(value);    updates.push(`value=$${params.length}`); }
    if (pressure !== undefined)            { params.push(pressure); updates.push(`pressure=$${params.length}`); }
    if (quality && validQuality.includes(quality)) { params.push(quality); updates.push(`quality=$${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows: [r] } = await pool.query(
      `UPDATE meter_readings SET ${updates.join(',')} WHERE id=$${params.length} RETURNING *`, params);
    if (!r) { log('WARN', 'Update reading: not found', { readingId: req.params.id }); return res.status(404).json({ error: 'Reading not found' }); }
    log('INFO', 'Reading updated', { readingId: r.id, meterId: r.meter_id, changes: req.body });
    res.json({ message: 'Reading updated', reading: r });
  } catch (e) {
    log('ERROR', 'Update reading FAILED', { readingId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE – Remove a reading */
app.delete('/api/usage/readings/:id', async (req, res) => {
  try {
    const { rows: [r] } = await pool.query('DELETE FROM meter_readings WHERE id=$1 RETURNING id, meter_id', [req.params.id]);
    if (!r) { log('WARN', 'Delete reading: not found', { readingId: req.params.id }); return res.status(404).json({ error: 'Reading not found' }); }
    log('INFO', 'Reading deleted', { readingId: r.id, meterId: r.meter_id });
    res.json({ message: 'Reading deleted', id: r.id });
  } catch (e) {
    log('ERROR', 'Delete reading FAILED', { readingId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── INGEST ──────────────────────────────────────────────────── */
app.post('/api/usage/ingest', async (req, res) => {
  const { meterId, type, value, pressure, userId } = req.body;
  if (!meterId || !type || value == null || !userId) {
    log('WARN', 'Ingest: missing fields', { meterId, type, userId });
    return res.status(400).json({ error: 'meterId, type, value, userId required' });
  }
  try {
    const { rows: [meter] } = await pool.query(
      'SELECT id, mqtt_topic FROM meters WHERE id=$1 AND user_id=$2', [meterId, userId]);
    if (!meter) {
      log('WARN', 'Ingest: meter not found or not owned', { meterId, userId });
      return res.status(404).json({ error: 'Meter not found or not owned by user' });
    }
    const unit    = type === 'water' ? 'L' : 'kWh';
    const quality = value < 0 ? 'anomaly' : 'normal';
    const { rows: [r] } = await pool.query(
      `INSERT INTO meter_readings (meter_id, user_id, type, value, unit, pressure, quality, mqtt_topic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [meterId, userId, type, value, unit, pressure || null, quality, meter.mqtt_topic]
    );
    log('INFO', 'Reading ingested', {
      readingId: r.id, meterId, type, value, unit, pressure: pressure || null,
      quality, userId, topic: meter.mqtt_topic
    });
    if (quality === 'anomaly') {
      log('WARN', 'ANOMALY detected on ingest', { meterId, type, value, userId, readingId: r.id });
    }
    res.status(201).json({ message: 'Reading ingested', reading: r });
  } catch (e) {
    log('ERROR', 'Ingest FAILED', { meterId, userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── SUMMARY & ANALYTICS ────────────────────────────────────── */
app.get('/api/usage/summary/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(value) FILTER (WHERE type='water'  AND recorded_at >= CURRENT_DATE), 0) AS today_water_l,
        COALESCE(SUM(value) FILTER (WHERE type='energy' AND recorded_at >= CURRENT_DATE), 0) AS today_energy_kwh,
        COALESCE(SUM(value) FILTER (WHERE type='water'  AND recorded_at >= DATE_TRUNC('month', NOW())), 0) AS month_water_l,
        COALESCE(SUM(value) FILTER (WHERE type='energy' AND recorded_at >= DATE_TRUNC('month', NOW())), 0) AS month_energy_kwh
      FROM meter_readings WHERE user_id=$1`, [req.params.userId]);
    log('INFO', 'Usage summary fetched', {
      userId:         req.params.userId,
      todayWaterL:    parseFloat(rows[0].today_water_l).toFixed(2),
      todayEnergyKwh: parseFloat(rows[0].today_energy_kwh).toFixed(2),
    });
    res.json({ userId: req.params.userId, lastUpdated: new Date(), summary: rows[0] });
  } catch (e) {
    log('ERROR', 'Usage summary FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/usage/monthly/:userId/:month', async (req, res) => {
  const { userId, month } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(value) FILTER (WHERE type='water'),  0) AS water_l,
        COALESCE(SUM(value) FILTER (WHERE type='energy'), 0) AS energy_kwh
      FROM meter_readings
      WHERE user_id=$1 AND TO_CHAR(recorded_at, 'YYYY-MM') = $2`, [userId, month]);
    log('INFO', 'Monthly usage fetched', { userId, month, waterL: rows[0].water_l, energyKwh: rows[0].energy_kwh });
    res.json({ userId, month, waterL: +parseFloat(rows[0].water_l).toFixed(2), energyKwh: +parseFloat(rows[0].energy_kwh).toFixed(2) });
  } catch (e) {
    log('ERROR', 'Monthly usage FAILED', { userId, month, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/usage/history/:userId', async (req, res) => {
  const { type, from, to, page = 1, limit = 48 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const params = [req.params.userId]; let where = 'WHERE user_id=$1';
    if (type)  { params.push(type);            where += ` AND type=$${params.length}`; }
    if (from)  { params.push(new Date(+from)); where += ` AND recorded_at>=$${params.length}`; }
    if (to)    { params.push(new Date(+to));   where += ` AND recorded_at<=$${params.length}`; }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT * FROM meter_readings ${where} ORDER BY recorded_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    log('INFO', 'Usage history fetched', { userId: req.params.userId, count: rows.length, type, page });
    res.json({ userId: req.params.userId, total: rows.length, page: +page, data: rows });
  } catch (e) {
    log('ERROR', 'Usage history FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/usage/analytics/:userId', async (req, res) => {
  const { type = 'water' } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT EXTRACT(HOUR FROM recorded_at) AS hour, ROUND(AVG(value)::numeric, 3) AS avg_value
      FROM meter_readings
      WHERE user_id=$1 AND type=$2 AND recorded_at >= NOW() - INTERVAL '7 days'
      GROUP BY hour ORDER BY hour`, [req.params.userId, type]);
    const peak = rows.reduce((m, r) => +r.avg_value > +m.avg_value ? r : m, rows[0] || {});
    log('INFO', 'Analytics fetched', { userId: req.params.userId, type, hours: rows.length, peakHour: peak?.hour });
    res.json({ userId: req.params.userId, type, unit: type==='water'?'L':'kWh', hourlyAvg: rows, peakHour: peak });
  } catch (e) {
    log('ERROR', 'Analytics FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── Startup ─────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  log('INFO', `Service started on port ${PORT}`, {
    port: PORT, node: process.version, pid: process.pid,
    env:  process.env.NODE_ENV || 'production',
  });
});

function gracefulShutdown(signal) {
  log('INFO', `${signal} received – shutting down`, { signal });
  server.close(() => pool.end(() => { log('INFO', 'Shutdown complete'); process.exit(0); }));
  setTimeout(() => { log('ERROR', 'Forced shutdown'); process.exit(1); }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException',  (e) => log('ERROR', 'Uncaught exception',  { err: e.message, stack: e.stack }));
process.on('unhandledRejection', (r) => log('ERROR', 'Unhandled rejection', { reason: String(r) }));
module.exports = app;
