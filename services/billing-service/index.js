/**
 * AquaSense – billing-service  (PostgreSQL / Aurora)
 * Port: 8082 | Tables: bills, payments, tariff_rates
 * Calls usage-service to fetch consumption data before generating bills
 */
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const axios   = require('axios');
const pool    = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 8082;
const USAGE_SVC = process.env.USAGE_SERVICE_URL || 'http://usage-service:8083';

app.use(helmet()); app.use(cors()); app.use(express.json()); app.use(morgan('combined'));

// ── Helpers ───────────────────────────────────────────────────

// Fetch active tariff rates from DB (no hardcoded values)
async function getRates() {
  const { rows } = await pool.query(
    `SELECT resource_type, rate_per_unit, unit, currency
     FROM tariff_rates WHERE active=true ORDER BY effective_from DESC`
  );
  const r = {};
  rows.forEach(row => { r[row.resource_type] = row; });
  return r;
}

async function calcBill(waterL, energyKwh) {
  const rates = await getRates();
  const waterCost  = +(waterL   * parseFloat(rates.water?.rate_per_unit  || 0)).toFixed(2);
  const energyCost = +(energyKwh * parseFloat(rates.energy?.rate_per_unit || 0)).toFixed(2);
  const fixed      = parseFloat(rates.fixed?.rate_per_unit || 0);
  return { waterL, energyKwh, waterCost, energyCost, fixedCharge: fixed, total: +(waterCost + energyCost + fixed).toFixed(2), currency: rates.water?.currency || 'INR' };
}

// ── Routes ───────────────────────────────────────────────────

app.get('/health', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ status:'healthy', service:'billing-service', db:'connected', uptime: process.uptime() }); }
  catch { res.status(503).json({ status:'unhealthy', db:'disconnected' }); }
});

app.get('/', (_, res) => res.json({ service:'billing-service', version:'1.0.0' }));

// Get all bills
app.get('/api/bills', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, u.name AS user_name, u.email FROM bills b
       JOIN users u ON b.user_id=u.id ORDER BY b.issued_at DESC`);
    res.json({ count: rows.length, bills: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Bill by ID
app.get('/api/bills/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bills WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Bill not found' });
    res.json({ bill: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Bills for a user
app.get('/api/bills/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bills WHERE user_id=$1 ORDER BY issued_at DESC`, [req.params.userId]);
    const unpaid = rows.filter(b => b.status === 'unpaid').reduce((s, b) => s + parseFloat(b.total), 0);
    res.json({ count: rows.length, totalUnpaid: +unpaid.toFixed(2), currency: 'INR', bills: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Generate bill – fetches consumption from usage-service
app.post('/api/bills/generate', async (req, res) => {
  const { userId, month } = req.body; // month = '2026-04'
  if (!userId || !month) return res.status(400).json({ error: 'userId and month required' });
  try {
    // Check for duplicate
    const dup = await pool.query('SELECT id FROM bills WHERE user_id=$1 AND month=$2', [userId, month]);
    if (dup.rows.length) return res.status(409).json({ error: 'Bill already exists for this month', bill: dup.rows[0] });

    // Fetch monthly usage from usage-service
    let waterL = 0, energyKwh = 0;
    try {
      const usageRes = await axios.get(`${USAGE_SVC}/api/usage/monthly/${userId}/${month}`, { timeout: 5000 });
      waterL    = usageRes.data.waterL    || 0;
      energyKwh = usageRes.data.energyKwh || 0;
    } catch (err) {
      console.warn('[billing] usage-service unavailable, using provided values:', err.message);
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
    res.status(201).json({ message: 'Bill generated', bill: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Pay a bill
app.post('/api/payments/pay', async (req, res) => {
  const { billId, userId, method = 'UPI' } = req.body;
  if (!billId || !userId) return res.status(400).json({ error: 'billId and userId required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bills } = await client.query('SELECT * FROM bills WHERE id=$1 FOR UPDATE', [billId]);
    if (!bills.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bill not found' }); }
    if (bills[0].status === 'paid') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already paid' }); }

    const ref = method.toUpperCase() + Date.now();
    const { rows: [payment] } = await client.query(
      `INSERT INTO payments (bill_id,user_id,amount,method,transaction_ref) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [billId, userId, bills[0].total, method, ref]
    );
    const { rows: [updated] } = await client.query(
      `UPDATE bills SET status='paid', paid_at=NOW() WHERE id=$1 RETURNING *`, [billId]);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Payment successful', payment, bill: updated });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Server error' }); }
  finally { client.release(); }
});

// User payment history
app.get('/api/payments/user/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, b.month FROM payments p JOIN bills b ON p.bill_id=b.id
       WHERE p.user_id=$1 ORDER BY p.paid_at DESC`, [req.params.userId]);
    res.json({ count: rows.length, payments: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Cost estimate (from DB rates, no hardcoding)
app.post('/api/billing/estimate', async (req, res) => {
  const { waterL = 0, energyKwh = 0 } = req.body;
  try { res.json({ estimate: await calcBill(+waterL, +energyKwh) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Tariff rates from DB
app.get('/api/billing/rates', async (_, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM tariff_rates WHERE active=true ORDER BY resource_type`);
    res.json({ rates: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

const server = app.listen(PORT, () => console.log(`[billing-service] :${PORT}`));

function gracefulShutdown(signal) {
  console.log(`[billing-service] ${signal} received – shutting down gracefully`);
  server.close(() => pool.end(() => { console.log('[billing-service] shutdown complete'); process.exit(0); }));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
module.exports = app;
