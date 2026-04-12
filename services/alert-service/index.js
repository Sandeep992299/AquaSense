/**
 * AquaSense – alert-service  (PostgreSQL / Aurora)
 * Port: 8084 | Tables: alerts, alert_subscriptions
 * Calls usage-service to detect anomalies from live readings
 *
 * IMPORTANT: Static routes (/stats, /subscriptions) must be declared
 * BEFORE the dynamic /:id route, otherwise Express captures them as id params.
 */
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const axios   = require('axios');
const pool    = require('./db/pool');   // FIXED: was '../db/pool'

const app  = express();
const PORT = process.env.PORT || 8084;
const USAGE_SVC = process.env.USAGE_SERVICE_URL || 'http://usage-service:8083';
const SNS_TOPIC = process.env.SNS_TOPIC_ARN     || 'arn:aws:sns:ap-south-1:123456789012:asu-alerts';
const SQS_QUEUE = process.env.SQS_ALERT_QUEUE   || 'alert-processing-queue';

app.use(helmet()); app.use(cors()); app.use(express.json()); app.use(morgan('combined'));

// ── Anomaly detection thresholds ──────────────────────────────
const THRESHOLDS = {
  water:  { highFlowL: 25, leakageL: 0.5, leakageHoursStart: 1, leakageHoursEnd: 4, lowPressureBar: 1.0, highPressureBar: 3.5 },
  energy: { spikeKwh: 2.5 },
};

function detectAnomalies(reading) {
  const { type, value, pressure } = reading;
  const alerts = [];
  if (type === 'water') {
    if (pressure && pressure < THRESHOLDS.water.lowPressureBar)
      alerts.push({ kind:'pressure', severity:'critical', msg:`Low pressure ${pressure} bar detected` });
    if (pressure && pressure > THRESHOLDS.water.highPressureBar)
      alerts.push({ kind:'pressure', severity:'warning',  msg:`High pressure ${pressure} bar detected` });
    if (value > THRESHOLDS.water.highFlowL)
      alerts.push({ kind:'highFlow', severity:'warning',  msg:`High flow ${value}L per reading` });
    const hr = new Date().getHours();
    if (hr >= THRESHOLDS.water.leakageHoursStart && hr <= THRESHOLDS.water.leakageHoursEnd && value > THRESHOLDS.water.leakageL)
      alerts.push({ kind:'leakage', severity:'critical', msg:`Leakage suspected – ${value}L at ${hr}:00` });
  }
  if (type === 'energy' && value > THRESHOLDS.energy.spikeKwh)
    alerts.push({ kind:'spike', severity:'warning', msg:`Energy spike ${value}kWh` });
  return alerts;
}

// Simulate SNS publish (real AWS SDK call goes here on deployment)
function simulateSNS(alert) {
  return { messageId: 'local-' + Date.now(), topic: SNS_TOPIC, alert: alert.title };
}

// ── Routes ────────────────────────────────────────────────────
// NOTE: Static sub-paths (stats, subscriptions) are registered BEFORE /:id

app.get('/health', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ status:'healthy', service:'alert-service', db:'connected', uptime: process.uptime() }); }
  catch { res.status(503).json({ status:'unhealthy', db:'disconnected' }); }
});

app.get('/', (_, res) => res.json({ service:'alert-service', version:'1.0.0' }));

// All alerts (filterable)
app.get('/api/alerts', async (req, res) => {
  const { severity, status, type } = req.query;
  try {
    const params = []; let where = 'WHERE 1=1';
    if (severity) { params.push(severity); where += ` AND severity=$${params.length}`; }
    if (status)   { params.push(status);   where += ` AND status=$${params.length}`; }
    if (type)     { params.push(type);     where += ` AND type=$${params.length}`; }
    const { rows } = await pool.query(
      `SELECT a.*, u.name AS user_name FROM alerts a LEFT JOIN users u ON a.user_id=u.id
       ${where} ORDER BY a.created_at DESC`, params);
    res.json({ count: rows.length, alerts: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Aggregate stats – BEFORE /:id ────────────────────────────
app.get('/api/alerts/stats', async (_, res) => {
  try {
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE status='active')        AS active,
        COUNT(*) FILTER (WHERE status='resolved')      AS resolved,
        COUNT(*) FILTER (WHERE severity='critical')    AS critical,
        COUNT(*) FILTER (WHERE severity='warning')     AS warning,
        COUNT(*) FILTER (WHERE severity='info')        AS info
      FROM alerts`);
    const { rows: [subs] } = await pool.query(`SELECT COUNT(*) AS confirmed FROM alert_subscriptions WHERE confirmed=true`);
    res.json({ ...stats, snsSubscribers: +subs.confirmed });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── SNS subscriptions – BEFORE /:id ──────────────────────────
app.get('/api/alerts/subscriptions', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alert_subscriptions ORDER BY created_at DESC');
    res.json({ topic: 'asu-alerts', count: rows.length, subscriptions: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/alerts/subscriptions', async (req, res) => {
  const { protocol, endpoint } = req.body;
  if (!protocol || !endpoint) return res.status(400).json({ error: 'protocol and endpoint required' });
  try {
    const { rows: [sub] } = await pool.query(
      `INSERT INTO alert_subscriptions (protocol, endpoint) VALUES ($1,$2) RETURNING *`, [protocol, endpoint]);
    res.status(201).json({ message: 'Subscription created (pending confirmation)', subscription: sub });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Alert by ID – AFTER static routes ────────────────────────
app.get('/api/alerts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alerts WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Alert not found' });
    res.json({ alert: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Alerts for a user (3-segment path – no conflict with /:id)
app.get('/api/alerts/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM alerts WHERE user_id=$1 ORDER BY created_at DESC`, [req.params.userId]);
    res.json({
      count:    rows.length,
      active:   rows.filter(a => a.status === 'active').length,
      critical: rows.filter(a => a.severity === 'critical').length,
      alerts:   rows,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Detect anomaly + create alert
app.post('/api/alerts/detect', async (req, res) => {
  const reading = req.body;
  if (!reading?.type || reading.value == null)
    return res.status(400).json({ error: 'Valid reading required (type, value, meterId, userId)' });

  const anomalies = detectAnomalies(reading);
  const created   = [];

  for (const an of anomalies) {
    try {
      const { rows: [alert] } = await pool.query(
        `INSERT INTO alerts (type, severity, title, description, meter_id, user_id, sns_published, sns_topic, sqs_queue)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [an.kind, an.severity, an.msg,
         `Auto-detected. Reading: ${reading.value}${reading.type==='water'?'L':'kWh'} on ${reading.meterId}`,
         reading.meterId || null, reading.userId || null,
         false, SNS_TOPIC, SQS_QUEUE]
      );
      const sns = simulateSNS(alert);
      await pool.query('UPDATE alerts SET sns_published=true WHERE id=$1', [alert.id]);
      created.push({ alert, sns });
    } catch (e) { console.error('[alert-detect]', e.message); }
  }

  res.status(created.length ? 201 : 200).json({
    anomaliesDetected: anomalies.length,
    message: anomalies.length ? `${anomalies.length} alert(s) created` : 'No anomalies detected',
    created,
  });
});

// Resolve an alert
app.patch('/api/alerts/:id/resolve', async (req, res) => {
  const { resolvedBy = 'operator' } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE alerts SET status='resolved', resolved_at=NOW(), resolved_by=$1
       WHERE id=$2 AND status='active' RETURNING *`, [resolvedBy, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Alert not found or already resolved' });
    res.json({ message: 'Alert resolved', alert: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Run anomaly check against latest readings from usage-service
app.post('/api/alerts/scan/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const usageRes  = await axios.get(`${USAGE_SVC}/api/usage/history/${userId}?limit=20`, { timeout: 5000 });
    const readings  = usageRes.data.data || [];
    let totalCreated = 0;
    for (const r of readings) {
      const anom = detectAnomalies({ ...r, meterId: r.meter_id, userId });
      for (const an of anom) {
        await pool.query(
          `INSERT INTO alerts (type,severity,title,description,meter_id,user_id,sns_topic,sqs_queue)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [an.kind, an.severity, an.msg, `Scan detected. Reading: ${r.value}`, r.meter_id, userId, SNS_TOPIC, SQS_QUEUE]
        );
        totalCreated++;
      }
    }
    res.json({ message: `Scan complete – ${totalCreated} alert(s) raised`, readingsChecked: readings.length });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── Server startup + graceful shutdown ────────────────────────
const server = app.listen(PORT, () => console.log(`[alert-service] :${PORT}`));

function gracefulShutdown(signal) {
  console.log(`[alert-service] ${signal} received – shutting down gracefully`);
  server.close(() => pool.end(() => { console.log('[alert-service] shutdown complete'); process.exit(0); }));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
module.exports = app;
