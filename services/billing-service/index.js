/**
 * AquaSense – billing-service  (PostgreSQL / Aurora)
 * Port: 8082 | Tables: bills, payments, tariff_rates
 * Rich structured CloudWatch logging on all routes
 */
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const axios   = require('axios');
const pool    = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8082;
const USAGE_SVC = process.env.USAGE_SERVICE_URL || 'http://usage-service:8083';
const SVC = 'billing-service';

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

/* ─── Helpers ────────────────────────────────────────────────── */
async function getRates() {
  const { rows } = await pool.query(
    `SELECT resource_type, rate_per_unit, unit, currency
     FROM tariff_rates WHERE active=true ORDER BY effective_from DESC`
  );
  const r = {};
  rows.forEach(row => { r[row.resource_type] = row; });
  log('DEBUG', 'Tariff rates fetched', { count: rows.length, types: Object.keys(r) });
  return r;
}

async function calcBill(waterL, energyKwh) {
  const rates      = await getRates();
  const waterCost  = +(waterL    * parseFloat(rates.water?.rate_per_unit  || 0)).toFixed(2);
  const energyCost = +(energyKwh * parseFloat(rates.energy?.rate_per_unit || 0)).toFixed(2);
  const fixed      = parseFloat(rates.fixed?.rate_per_unit || 0);
  const total      = +(waterCost + energyCost + fixed).toFixed(2);
  log('DEBUG', 'Bill calculated', { waterL, energyKwh, waterCost, energyCost, fixed, total });
  return { waterL, energyKwh, waterCost, energyCost, fixedCharge: fixed, total, currency: rates.water?.currency || 'INR' };
}

/* ─── Routes ─────────────────────────────────────────────────── */

app.get('/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    log('INFO', 'Health check OK', { db: 'connected', uptime_s: Math.round(process.uptime()), usage_svc: USAGE_SVC });
    res.json({ status: 'healthy', service: SVC, db: 'connected', uptime: process.uptime(), version: process.env.IMAGE_TAG || 'local' });
  } catch (e) {
    log('ERROR', 'Health check FAILED', { err: e.message });
    res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
  }
});

app.get('/', (_, res) => res.json({ service: SVC, version: '2.0.0' }));

/* All bills */
app.get('/api/bills', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, u.name AS user_name, u.email FROM bills b
       JOIN users u ON b.user_id=u.id ORDER BY b.issued_at DESC`);
    log('INFO', 'All bills fetched', { count: rows.length });
    res.json({ count: rows.length, bills: rows });
  } catch (e) {
    log('ERROR', 'Fetch all bills FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Bill by ID */
app.get('/api/bills/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bills WHERE id=$1', [req.params.id]);
    if (!rows.length) { log('WARN', 'Bill not found', { billId: req.params.id }); return res.status(404).json({ error: 'Bill not found' }); }
    log('INFO', 'Bill fetched', { billId: req.params.id, userId: rows[0].user_id, total: rows[0].total });
    res.json({ bill: rows[0] });
  } catch (e) {
    log('ERROR', 'Fetch bill FAILED', { billId: req.params.id, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Bills for a user */
app.get('/api/bills/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bills WHERE user_id=$1 ORDER BY issued_at DESC`, [req.params.userId]);
    const unpaid = rows.filter(b => b.status === 'unpaid').reduce((s, b) => s + parseFloat(b.total), 0);
    log('INFO', 'User bills fetched', { userId: req.params.userId, count: rows.length, totalUnpaid: unpaid.toFixed(2) });
    res.json({ count: rows.length, totalUnpaid: +unpaid.toFixed(2), currency: 'INR', bills: rows });
  } catch (e) {
    log('ERROR', 'User bills FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Generate bill */
app.post('/api/bills/generate', async (req, res) => {
  const { userId, month } = req.body;
  if (!userId || !month) {
    log('WARN', 'Bill generate: missing params', { body: req.body });
    return res.status(400).json({ error: 'userId and month required' });
  }
  log('INFO', 'Bill generation started', { userId, month });
  try {
    const dup = await pool.query('SELECT id FROM bills WHERE user_id=$1 AND month=$2', [userId, month]);
    if (dup.rows.length) {
      log('WARN', 'Bill already exists', { userId, month, existingBillId: dup.rows[0].id });
      return res.status(409).json({ error: 'Bill already exists for this month', bill: dup.rows[0] });
    }

    let waterL = 0, energyKwh = 0, usageSrcMsg = 'provided';
    try {
      log('INFO', 'Fetching usage from usage-service', { url: `${USAGE_SVC}/api/usage/monthly/${userId}/${month}` });
      const usageRes = await axios.get(`${USAGE_SVC}/api/usage/monthly/${userId}/${month}`, { timeout: 5000 });
      waterL    = usageRes.data.waterL    || 0;
      energyKwh = usageRes.data.energyKwh || 0;
      usageSrcMsg = 'usage-service';
      log('INFO', 'Usage fetched from usage-service', { userId, month, waterL, energyKwh });
    } catch (err) {
      log('WARN', 'usage-service unavailable – using body values', { err: err.message, fallback: { waterL: req.body.waterL, energyKwh: req.body.energyKwh } });
      waterL    = req.body.waterL    || 0;
      energyKwh = req.body.energyKwh || 0;
    }

    const calc    = await calcBill(waterL, energyKwh);
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 15);
    const { rows } = await pool.query(
      `INSERT INTO bills (user_id,month,water_litres,energy_kwh,water_cost,energy_cost,fixed_charge,total,currency,due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [userId, month, calc.waterL, calc.energyKwh, calc.waterCost, calc.energyCost, calc.fixedCharge, calc.total, calc.currency, dueDate]
    );
    log('INFO', 'Bill generated SUCCESS', {
      userId, month, billId: rows[0].id, total: calc.total, currency: calc.currency,
      waterL, energyKwh, usageSource: usageSrcMsg, dueDate: dueDate.toISOString()
    });
    res.status(201).json({ message: 'Bill generated', bill: rows[0] });
  } catch (e) {
    log('ERROR', 'Bill generation FAILED', { userId, month, err: e.message, stack: e.stack?.split('\n')[1] });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Pay a bill */
app.post('/api/payments/pay', async (req, res) => {
  const { billId, userId, method = 'UPI' } = req.body;
  if (!billId || !userId) {
    log('WARN', 'Payment: missing params', { billId, userId });
    return res.status(400).json({ error: 'billId and userId required' });
  }
  log('INFO', 'Payment initiated', { billId, userId, method });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bills } = await client.query('SELECT * FROM bills WHERE id=$1 FOR UPDATE', [billId]);
    if (!bills.length) {
      await client.query('ROLLBACK');
      log('WARN', 'Payment: bill not found', { billId });
      return res.status(404).json({ error: 'Bill not found' });
    }
    if (bills[0].status === 'paid') {
      await client.query('ROLLBACK');
      log('WARN', 'Payment: bill already paid', { billId, userId });
      return res.status(409).json({ error: 'Already paid' });
    }

    const ref = method.toUpperCase() + Date.now();
    const { rows: [payment] } = await client.query(
      `INSERT INTO payments (bill_id,user_id,amount,method,transaction_ref) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [billId, userId, bills[0].total, method, ref]
    );
    const { rows: [updated] } = await client.query(
      `UPDATE bills SET status='paid', paid_at=NOW() WHERE id=$1 RETURNING *`, [billId]);
    await client.query('COMMIT');

    log('INFO', 'Payment SUCCESS', {
      paymentId: payment.id, billId, userId, amount: bills[0].total,
      method, txRef: ref, billStatus: updated.status
    });
    res.status(201).json({ message: 'Payment successful', payment, bill: updated });
  } catch (e) {
    await client.query('ROLLBACK');
    log('ERROR', 'Payment FAILED – rolled back', { billId, userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

/* Payment history */
app.get('/api/payments/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, b.month FROM payments p JOIN bills b ON p.bill_id=b.id
       WHERE p.user_id=$1 ORDER BY p.paid_at DESC`, [req.params.userId]);
    log('INFO', 'Payment history fetched', { userId: req.params.userId, count: rows.length });
    res.json({ count: rows.length, payments: rows });
  } catch (e) {
    log('ERROR', 'Payment history FAILED', { userId: req.params.userId, err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Cost estimate */
app.post('/api/billing/estimate', async (req, res) => {
  const { waterL = 0, energyKwh = 0 } = req.body;
  try {
    const estimate = await calcBill(+waterL, +energyKwh);
    log('INFO', 'Cost estimate computed', { waterL, energyKwh, total: estimate.total });
    res.json({ estimate });
  } catch (e) {
    log('ERROR', 'Cost estimate FAILED', { err: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

/* Tariff rates */
app.get('/api/billing/rates', async (_, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM tariff_rates WHERE active=true ORDER BY resource_type`);
    log('INFO', 'Tariff rates returned', { count: rows.length });
    res.json({ rates: rows });
  } catch (e) {
    log('ERROR', 'Tariff rates FAILED', { err: e.message });
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
    env:      process.env.NODE_ENV || 'production',
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
