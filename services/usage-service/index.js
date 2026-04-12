/**
 * AquaSense – usage-service  (PostgreSQL / Aurora)
 * Port: 8083 | Tables: meter_readings, meters
 * IoT simulation: POST /api/usage/ingest
 */
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const pool    = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8083;

app.use(helmet()); app.use(cors()); app.use(express.json()); app.use(morgan('combined'));

// ── Routes ───────────────────────────────────────────────────

app.get('/health', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ status:'healthy', service:'usage-service', db:'connected', uptime: process.uptime() }); }
  catch { res.status(503).json({ status:'unhealthy', db:'disconnected' }); }
});

app.get('/', (_, res) => res.json({ service:'usage-service', version:'1.0.0' }));

// All meters (with latest reading each)
app.get('/api/usage/meters', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        u.name AS user_name,
        (SELECT value  FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS latest_value,
        (SELECT unit   FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS unit,
        (SELECT recorded_at FROM meter_readings r WHERE r.meter_id=m.id ORDER BY recorded_at DESC LIMIT 1) AS last_seen
      FROM meters m JOIN users u ON m.user_id=u.id
      ORDER BY m.registered_at`);
    res.json({ count: rows.length, meters: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Readings for a meter (paginated)
app.get('/api/usage/readings/:meterId', async (req, res) => {
  const { page = 1, limit = 48, type } = req.query;
  const offset = (page - 1) * limit;
  try {
    const params = [req.params.meterId, limit, offset];
    let where = 'WHERE meter_id=$1';
    if (type) { where += ' AND type=$4'; params.push(type); }
    const { rows } = await pool.query(
      `SELECT * FROM meter_readings ${where} ORDER BY recorded_at DESC LIMIT $2 OFFSET $3`, params);
    const { rows: [cnt] } = await pool.query(`SELECT COUNT(*) FROM meter_readings ${where}`, [req.params.meterId, ...(type ? [type] : [])]);
    res.json({ meterId: req.params.meterId, total: +cnt.count, page: +page, data: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Usage summary for a user (today + month totals)
app.get('/api/usage/summary/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(value) FILTER (WHERE type='water'  AND recorded_at >= CURRENT_DATE), 0) AS today_water_l,
        COALESCE(SUM(value) FILTER (WHERE type='energy' AND recorded_at >= CURRENT_DATE), 0) AS today_energy_kwh,
        COALESCE(SUM(value) FILTER (WHERE type='water'  AND recorded_at >= DATE_TRUNC('month', NOW())), 0) AS month_water_l,
        COALESCE(SUM(value) FILTER (WHERE type='energy' AND recorded_at >= DATE_TRUNC('month', NOW())), 0) AS month_energy_kwh
      FROM meter_readings WHERE user_id=$1`, [req.params.userId]);
    res.json({ userId: req.params.userId, lastUpdated: new Date(), summary: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Monthly totals – called by billing-service
app.get('/api/usage/monthly/:userId/:month', async (req, res) => {
  const { userId, month } = req.params;   // month = '2026-04'
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(value) FILTER (WHERE type='water'),  0) AS water_l,
        COALESCE(SUM(value) FILTER (WHERE type='energy'), 0) AS energy_kwh
      FROM meter_readings
      WHERE user_id=$1
        AND TO_CHAR(recorded_at, 'YYYY-MM') = $2`, [userId, month]);
    res.json({ userId, month, waterL: +parseFloat(rows[0].water_l).toFixed(2), energyKwh: +parseFloat(rows[0].energy_kwh).toFixed(2) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// History for a user (filterable)
app.get('/api/usage/history/:userId', async (req, res) => {
  const { type, from, to, page = 1, limit = 48 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const params = [req.params.userId];
    let where = 'WHERE user_id=$1';
    if (type)  { params.push(type);            where += ` AND type=$${params.length}`; }
    if (from)  { params.push(new Date(+from)); where += ` AND recorded_at>=$${params.length}`; }
    if (to)    { params.push(new Date(+to));   where += ` AND recorded_at<=$${params.length}`; }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT * FROM meter_readings ${where} ORDER BY recorded_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    res.json({ userId: req.params.userId, total: rows.length, page: +page, data: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Ingest a new IoT reading (called by IoT simulator / Lambda)
app.post('/api/usage/ingest', async (req, res) => {
  const { meterId, type, value, pressure, userId } = req.body;
  if (!meterId || !type || value == null || !userId)
    return res.status(400).json({ error: 'meterId, type, value, userId required' });
  try {
    // Verify meter exists and belongs to user
    const { rows: [meter] } = await pool.query(
      'SELECT id, mqtt_topic FROM meters WHERE id=$1 AND user_id=$2', [meterId, userId]);
    if (!meter) return res.status(404).json({ error: 'Meter not found or not owned by user' });

    const unit        = type === 'water' ? 'L' : 'kWh';
    const quality     = value < 0 ? 'anomaly' : 'normal';
    const { rows:[r]} = await pool.query(
      `INSERT INTO meter_readings (meter_id, user_id, type, value, unit, pressure, quality, mqtt_topic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [meterId, userId, type, value, unit, pressure || null, quality, meter.mqtt_topic]
    );
    res.status(201).json({ message: 'Reading ingested', reading: r });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Hourly analytics per user
app.get('/api/usage/analytics/:userId', async (req, res) => {
  const { type = 'water' } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT EXTRACT(HOUR FROM recorded_at) AS hour,
             ROUND(AVG(value)::numeric, 3) AS avg_value
      FROM meter_readings
      WHERE user_id=$1 AND type=$2
        AND recorded_at >= NOW() - INTERVAL '7 days'
      GROUP BY hour ORDER BY hour`, [req.params.userId, type]);
    const peakHour = rows.reduce((m, r) => +r.avg_value > +m.avg_value ? r : m, rows[0] || {});
    res.json({ userId: req.params.userId, type, unit: type==='water'?'L':'kWh', hourlyAvg: rows, peakHour });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

const server = app.listen(PORT, () => console.log(`[usage-service] :${PORT}`));

function gracefulShutdown(signal) {
  console.log(`[usage-service] ${signal} received – shutting down gracefully`);
  server.close(() => pool.end(() => { console.log('[usage-service] shutdown complete'); process.exit(0); }));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
module.exports = app;
