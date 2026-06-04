/**
 * AquaSense – alert-service  (PostgreSQL / Aurora)
 * Port: 8084 | Tables: alerts, alert_subscriptions
 * Rich structured CloudWatch logging + full CRUD for alerts
 *
 * IMPORTANT: Static routes (/stats, /subscriptions, /user/:id)
 * are declared BEFORE the dynamic /:id route.
 */
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const axios   = require('axios');
const pool    = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8084;
const USAGE_SVC = process.env.USAGE_SERVICE_URL || 'http://usage-service:8083';
const SNS_TOPIC = process.env.SNS_TOPIC_ARN     || 'arn:aws:sns:ap-south-1:595529181954:aquasense-alerts';
const SQS_QUEUE = process.env.SQS_ALERT_QUEUE   || 'alert-processing-queue';
const SVC = 'alert-service';

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
    });
  });
  next();
});

app.use(helmet());
app.use(cors());
app.use(express.json());

/* ─── Anomaly Detection Thresholds ──────────────────────────── */
const THRESHOLDS = {
  water:  { highFlowL: 25, leakageL: 0.5, leakageHoursStart: 1, leakageHoursEnd: 4, lowPressureBar: 1.0, highPressureBar: 3.5 },
  energy: { spikeKwh: 2.5 },
};

function detectAnomalies(reading) {
  const { type, value, pressure } = reading;
  const alerts = [];
  if (type === 'water') {
    if (pressure && pressure < THRESHOLDS.water.lowPressureBar)
      alerts.push({ kind: 'pressure', severity: 'critical', msg: `Low pressure ${pressure} bar detected` });
    if (pressure && pressure > THRESHOLDS.water.highPressureBar)
      alerts.push({ kind: 'pressure', severity: 'warning',  msg: `High pressure ${pressure} bar detected` });
    if (value > THRESHOLDS.water.highFlowL)
      alerts.push({ kind: 'highFlow', severity: 'warning',  msg: `High flow ${value}L per reading` });
    const hr = new Date().getHours();
    if (hr >= THRESHOLDS.water.leakageHoursStart && hr <= THRESHOLDS.water.leakageHoursEnd && value > THRESHOLDS.water.leakageL)
      alerts.push({ kind: 'leakage', severity: 'critical', msg: `Leakage suspected – ${value}L at ${hr}:00` });
  }
  if (type === 'energy' && value > THRESHOLDS.energy.spikeKwh)
    alerts.push({ kind: 'spike', severity: 'warning', msg: `Energy spike ${value}kWh` });
  return alerts;
}

/* ─── SNS Helper ─────────────────────────────────────────────── */
function simulateSNS(alert) {
  const msgId = 'sns-' + Date.now();
  log('INFO', 'SNS publish (simulated)', {
    topic:     SNS_TOPIC,
    messageId: msgId,
    alertId:   alert.id,
    severity:  alert.severity,
    title:     alert.title,
  });
  return { messageId: msgId, topic: SNS_TOPIC, alert: alert.title };
}

/* ─── Routes ─────────────────────────────────────────────────── */

app.get('/health', async (_, res) => {
  try {
    const { rows: [stats] } = await pool.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status='active') AS active
      FROM alerts`);
    log('INFO', 'Health check OK', {
      db: 'connected', uptime_s: Math.round(process.uptime()),
      alerts_total: +stats.total, alerts_active: +stats.active
    });
    res.json({ status: 'healthy', service: SVC, db: 'connected', uptime: process.uptime(), version: process.env.IMAGE_TAG || 'local' });
  } catch (e) {
    log('ERROR', 'Health check FAILED', { err: e.message });
    res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
  }
});

app.get('/', (_, res) => res.json({ service: SVC, version: '2.0.0' }));

/* ─── Static sub-paths BEFORE /:id ──────────────────────────── */

/* GET all alerts (filterable) */
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
    log('INFO', 'All alerts fetched', { count: rows.length, filters: { severity, status, type } });
    res.json({ count: rows.length, alerts: rows });
  } catch (e) {
    log('ERROR', 'Fetch all alerts FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST – Create alert manually */
app.post('/api/alerts', async (req, res) => {
  const { title, description, severity = 'info', type = 'manual', meter_id, user_id } = req.body;
  if (!title) {
    log('WARN', 'Create alert: title required');
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const { rows: [alert] } = await pool.query(
      `INSERT INTO alerts (type, severity, title, description, meter_id, user_id, sns_topic, sqs_queue)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [type, severity, title, description || null, meter_id || null, user_id || null, SNS_TOPIC, SQS_QUEUE]
    );
    const sns = simulateSNS(alert);
    await pool.query('UPDATE alerts SET sns_published=true WHERE id=$1', [alert.id]);
    log('INFO', 'Alert created manually', {
      alertId: alert.id, title, severity, type, meterId: meter_id, userId: user_id, snsMessageId: sns.messageId
    });
    res.status(201).json({ message: 'Alert created', alert, sns });
  } catch (e) {
    log('ERROR', 'Create alert FAILED', { title, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET stats – BEFORE /:id */
app.get('/api/alerts/stats', async (_, res) => {
  try {
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(*)                                     AS total,
        COUNT(*) FILTER (WHERE status='active')     AS active,
        COUNT(*) FILTER (WHERE status='resolved')   AS resolved,
        COUNT(*) FILTER (WHERE severity='critical') AS critical,
        COUNT(*) FILTER (WHERE severity='warning')  AS warning,
        COUNT(*) FILTER (WHERE severity='info')     AS info
      FROM alerts`);
    const { rows: [subs] } = await pool.query(`SELECT COUNT(*) AS confirmed FROM alert_subscriptions WHERE confirmed=true`);
    log('INFO', 'Alert stats fetched', { ...stats, snsSubscribers: +subs.confirmed });
    res.json({ ...stats, snsSubscribers: +subs.confirmed });
  } catch (e) {
    log('ERROR', 'Alert stats FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET subscriptions – BEFORE /:id */
app.get('/api/alerts/subscriptions', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alert_subscriptions ORDER BY created_at DESC');
    log('INFO', 'Subscriptions fetched', { count: rows.length });
    res.json({ topic: SNS_TOPIC, count: rows.length, subscriptions: rows });
  } catch (e) {
    log('ERROR', 'Subscriptions FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/alerts/subscriptions', async (req, res) => {
  const { protocol, endpoint } = req.body;
  if (!protocol || !endpoint) return res.status(400).json({ error: 'protocol and endpoint required' });
  try {
    const { rows: [sub] } = await pool.query(
      `INSERT INTO alert_subscriptions (protocol, endpoint) VALUES ($1,$2) RETURNING *`, [protocol, endpoint]);
    log('INFO', 'Subscription created', { protocol, endpoint: endpoint.substring(0, 30), subId: sub.id });
    res.status(201).json({ message: 'Subscription created (pending confirmation)', subscription: sub });
  } catch (e) {
    log('ERROR', 'Subscription create FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET user alerts – BEFORE /:id */
app.get('/api/alerts/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM alerts WHERE user_id=$1 ORDER BY created_at DESC`, [req.params.userId]);
    const active   = rows.filter(a => a.status === 'active').length;
    const critical = rows.filter(a => a.severity === 'critical').length;
    log('INFO', 'User alerts fetched', { userId: req.params.userId, total: rows.length, active, critical });
    res.json({ count: rows.length, active, critical, alerts: rows });
  } catch (e) {
    log('ERROR', 'User alerts FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST detect anomalies – BEFORE /:id */
app.post('/api/alerts/detect', async (req, res) => {
  const reading = req.body;
  if (!reading?.type || reading.value == null)
    return res.status(400).json({ error: 'Valid reading required (type, value, meterId, userId)' });

  const anomalies = detectAnomalies(reading);
  log('INFO', 'Anomaly detection run', {
    meterId:   reading.meterId, type: reading.type, value: reading.value,
    anomalies: anomalies.length, kinds: anomalies.map(a => a.kind)
  });

  const created = [];
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
      log('WARN', `ANOMALY alert raised: ${an.severity.toUpperCase()}`, {
        alertId: alert.id, kind: an.kind, severity: an.severity,
        meterId: reading.meterId, value: reading.value, snsMessageId: sns.messageId
      });
      created.push({ alert, sns });
    } catch (e) { log('ERROR', 'Alert creation FAILED in detect loop', { kind: an.kind, err: e.message }); }
  }

  res.status(created.length ? 201 : 200).json({
    anomaliesDetected: anomalies.length,
    message: anomalies.length ? `${anomalies.length} alert(s) created` : 'No anomalies detected',
    created,
  });
});

/* POST scan user – BEFORE /:id */
app.post('/api/alerts/scan/:userId', async (req, res) => {
  const { userId } = req.params;
  log('INFO', 'Anomaly scan started', { userId, usageSvc: USAGE_SVC });
  try {
    const usageRes = await axios.get(`${USAGE_SVC}/api/usage/history/${userId}?limit=20`, { timeout: 5000 });
    const readings = usageRes.data.data || [];
    log('INFO', 'Readings fetched for scan', { userId, readingsCount: readings.length });
    let totalCreated = 0;
    for (const r of readings) {
      const anom = detectAnomalies({ ...r, meterId: r.meter_id, userId });
      for (const an of anom) {
        await pool.query(
          `INSERT INTO alerts (type,severity,title,description,meter_id,user_id,sns_topic,sqs_queue)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [an.kind, an.severity, an.msg, `Scan detected. Reading: ${r.value}`, r.meter_id, userId, SNS_TOPIC, SQS_QUEUE]
        );
        log('WARN', `Scan alert raised: ${an.severity.toUpperCase()}`, {
          kind: an.kind, meterId: r.meter_id, value: r.value, userId
        });
        totalCreated++;
      }
    }
    log('INFO', 'Anomaly scan complete', { userId, readingsChecked: readings.length, alertsRaised: totalCreated });
    res.json({ message: `Scan complete – ${totalCreated} alert(s) raised`, readingsChecked: readings.length });
  } catch (e) {
    log('ERROR', 'Anomaly scan FAILED', { userId, err: e.message });
    res.status(500).json({ error: e.message });
  }
});

/* ─── Dynamic /:id routes AFTER all static paths ─────────────── */

/* GET single alert */
app.get('/api/alerts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alerts WHERE id=$1', [req.params.id]);
    if (!rows.length) { log('WARN', 'Alert not found', { alertId: req.params.id }); return res.status(404).json({ error: 'Alert not found' }); }
    res.json({ alert: rows[0] });
  } catch (e) {
    log('ERROR', 'Fetch alert FAILED', { alertId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT resolve alert (also supports PATCH for backward compat) */
const resolveHandler = async (req, res) => {
  const { resolvedBy = 'operator' } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE alerts SET status='resolved', resolved_at=NOW(), resolved_by=$1
       WHERE id=$2 AND status='active' RETURNING *`, [resolvedBy, req.params.id]);
    if (!rows.length) {
      log('WARN', 'Resolve: alert not found or already resolved', { alertId: req.params.id });
      return res.status(404).json({ error: 'Alert not found or already resolved' });
    }
    log('INFO', 'Alert resolved', { alertId: rows[0].id, severity: rows[0].severity, resolvedBy, title: rows[0].title });
    res.json({ message: 'Alert resolved', alert: rows[0] });
  } catch (e) {
    log('ERROR', 'Resolve alert FAILED', { alertId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
};
app.put('/api/alerts/:id/resolve',   resolveHandler);
app.patch('/api/alerts/:id/resolve', resolveHandler);

/* DELETE alert */
app.delete('/api/alerts/:id', async (req, res) => {
  try {
    const { rows: [a] } = await pool.query('DELETE FROM alerts WHERE id=$1 RETURNING id, title, severity', [req.params.id]);
    if (!a) { log('WARN', 'Delete alert: not found', { alertId: req.params.id }); return res.status(404).json({ error: 'Alert not found' }); }
    log('INFO', 'Alert deleted', { alertId: a.id, title: a.title, severity: a.severity });
    res.json({ message: 'Alert deleted', id: a.id });
  } catch (e) {
    log('ERROR', 'Delete alert FAILED', { alertId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─── Startup ─────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  log('INFO', `Service started on port ${PORT}`, {
    port:     PORT,
    node:     process.version,
    pid:      process.pid,
    usageSvc: USAGE_SVC,
    snsTopic: SNS_TOPIC,
    env:      process.env.NODE_ENV || 'production',
    thresholds: THRESHOLDS,
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
