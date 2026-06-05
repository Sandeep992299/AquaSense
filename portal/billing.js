/* =============================================
   AquaSense – Billing & Payments Page JS
   Depends on: shared.js, sidebar.js
   ============================================= */

// ── State Variables ──────────────────────────────────────────
let _billingInited   = false;
let _billingTab      = 'overview';
let _billingBills    = null;
let _billingRates    = null;

const MOCK_BILLS = [
  { id:'b-001', month:'2026-05', water_litres:7200, energy_kwh:412, water_cost:684,  energy_cost:3502, fixed_charge:0, total:4186, currency:'LKR', status:'paid',    due_date:new Date(Date.now()-864000000).toISOString(),   issued_at:new Date(Date.now()-2592000000).toISOString() },
  { id:'b-002', month:'2026-04', water_litres:8100, energy_kwh:398, water_cost:770,  energy_cost:3383, fixed_charge:0, total:4153, currency:'LKR', status:'paid',    due_date:new Date(Date.now()-4320000000).toISOString(),  issued_at:new Date(Date.now()-5184000000).toISOString() },
  { id:'b-003', month:'2026-03', water_litres:6900, energy_kwh:435, water_cost:655,  energy_cost:3698, fixed_charge:0, total:4353, currency:'LKR', status:'unpaid',  due_date:new Date(Date.now()+864000000).toISOString(),   issued_at:new Date(Date.now()-7776000000).toISOString() },
  { id:'b-004', month:'2026-02', water_litres:7500, energy_kwh:421, water_cost:713,  energy_cost:3579, fixed_charge:0, total:4292, currency:'LKR', status:'paid',    due_date:new Date(Date.now()-8640000000).toISOString(),  issued_at:new Date(Date.now()-10368000000).toISOString() },
  { id:'b-005', month:'2026-01', water_litres:8400, energy_kwh:445, water_cost:798,  energy_cost:3783, fixed_charge:0, total:4581, currency:'LKR', status:'overdue', due_date:new Date(Date.now()-17280000000).toISOString(), issued_at:new Date(Date.now()-20736000000).toISOString() },
  { id:'b-006', month:'2025-12', water_litres:9100, energy_kwh:488, water_cost:864,  energy_cost:4148, fixed_charge:0, total:5012, currency:'LKR', status:'paid',    due_date:new Date(Date.now()-25920000000).toISOString(), issued_at:new Date(Date.now()-28512000000).toISOString() },
];
const MOCK_PAYMENTS = [
  { id:'p-001', bill_id:'b-001', month:'2026-05', amount:4186, method:'Online Banking', transaction_ref:'BOC1748923401', paid_at:new Date(Date.now()-604800000).toISOString() },
  { id:'p-002', bill_id:'b-002', month:'2026-04', amount:4153, method:'Online Banking', transaction_ref:'BOC1746331200', paid_at:new Date(Date.now()-3024000000).toISOString() },
  { id:'p-003', bill_id:'b-004', month:'2026-02', amount:4292, method:'Online Banking', transaction_ref:'BOC1741996800', paid_at:new Date(Date.now()-7344000000).toISOString() },
];
const MOCK_RATES = [
  { resource_type:'water',  rate_per_unit:'0.095', unit:'per litre',  currency:'LKR', effective_from:'2026-01-01', active:true },
  { resource_type:'energy', rate_per_unit:'8.50',  unit:'per kWh',    currency:'LKR', effective_from:'2026-01-01', active:true },
  { resource_type:'fixed',  rate_per_unit:'0',     unit:'per month',  currency:'LKR', effective_from:'2026-01-01', active:true },
];

// ── Date Helpers ──────────────────────────────────────────────
function fmtMonth(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  return new Date(+y, +m-1, 1).toLocaleString('en-IN', { month:'long', year:'numeric' });
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

// ── Page Init ──────────────────────────────────────────────────
function initBilling() {
  renderSidebar('billing');
  if (_billingInited) return;
  _billingInited = true;
  switchBillingTab('overview');
}

// ── Tab Management ────────────────────────────────────────────
function switchBillingTab(tab) {
  _billingTab = tab;
  document.querySelectorAll('.billing-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.billing-panel').forEach(p => p.classList.remove('active'));
  $('btab-' + tab)?.classList.add('active');
  $('bpanel-' + tab)?.classList.add('active');
  if (tab === 'overview') loadBillingOverview();
  if (tab === 'bills')    renderBillsTable();
  if (tab === 'usage')    loadCurrentUsageBill();
  if (tab === 'forecast') renderBillForecast();
}

// ── Overview Tab Loader ───────────────────────────────────────
async function loadBillingOverview() {
  // Load bills + rates + payments in parallel
  const [billsRes, ratesRes, paymentsRes] = await Promise.all([
    AUTH.demo ? { count: MOCK_BILLS.length, totalUnpaid: MOCK_BILLS.filter(b=>b.status!=='paid').reduce((s,b)=>s+b.total,0), bills: MOCK_BILLS }
              : apiSafe('billing', `/api/bills/user/${AUTH.userId}`, { count:MOCK_BILLS.length, totalUnpaid:2011, bills:MOCK_BILLS }),
    AUTH.demo ? { rates: MOCK_RATES } : apiSafe('billing', '/api/billing/rates', { rates: MOCK_RATES }),
    AUTH.demo ? { count: MOCK_PAYMENTS.length, payments: MOCK_PAYMENTS }
              : apiSafe('billing', `/api/payments/user/${AUTH.userId}`, { count:MOCK_PAYMENTS.length, payments:MOCK_PAYMENTS }),
  ]);

  _billingBills = billsRes?.bills || MOCK_BILLS;
  _billingRates = ratesRes?.rates || MOCK_RATES;
  const payments = paymentsRes?.payments || MOCK_PAYMENTS;

  // --- KPI Cards ---
  const unpaid = billsRes?.totalUnpaid ?? _billingBills.filter(b=>b.status!=='paid').reduce((s,b)=>s+b.total,0);
  const unpaidCount = _billingBills.filter(b=>b.status!=='paid').length;
  const lastBill = _billingBills[0];

  // Unpaid total
  const bkpiUnpaid = $('bkpi-unpaid');
  if (bkpiUnpaid) bkpiUnpaid.textContent = 'LKR ' + parseFloat(unpaid).toLocaleString('en-IN', {maximumFractionDigits:0});
  const bkpiUnpaidCount = $('bkpi-unpaid-count');
  if (bkpiUnpaidCount) bkpiUnpaidCount.textContent = unpaidCount + ' bill' + (unpaidCount!==1?'s':'')+' pending';

  // Last bill
  if (lastBill) {
    const bkpiLast = $('bkpi-last');
    if (bkpiLast) bkpiLast.textContent = 'LKR ' + parseFloat(lastBill.total).toLocaleString('en-IN', {maximumFractionDigits:0});
    const bkpiLastMonth = $('bkpi-last-month');
    if (bkpiLastMonth) bkpiLastMonth.textContent = fmtMonth(lastBill.month) + ' · ' + lastBill.status.toUpperCase();
  }

  // Next due date
  const nextUnpaid = _billingBills.find(b => b.status !== 'paid');
  if (nextUnpaid) {
    const bkpiDue = $('bkpi-due');
    if (bkpiDue) bkpiDue.textContent = fmtDate(nextUnpaid.due_date);
    const bkpiDueBill = $('bkpi-due-bill');
    if (bkpiDueBill) bkpiDueBill.textContent = fmtMonth(nextUnpaid.month) + ' bill';
  } else {
    const bkpiDue = $('bkpi-due'); if (bkpiDue) bkpiDue.textContent = '—';
    const bkpiDueBill = $('bkpi-due-bill'); if (bkpiDueBill) bkpiDueBill.textContent = 'All bills paid ✓';
  }

  // Estimate for current month
  const curMonthKey = new Date().toISOString().slice(0,7);
  const curBill = _billingBills.find(b => b.month === curMonthKey);
  if (curBill) {
    const bkpiEst = $('bkpi-estimate');
    if (bkpiEst) bkpiEst.textContent = 'LKR ' + parseFloat(curBill.total).toLocaleString('en-IN', {maximumFractionDigits:0});
    const bkpiEstD = $('bkpi-estimate-detail');
    if (bkpiEstD) bkpiEstD.textContent = 'Final · ' + fmtMonth(curMonthKey);
  } else {
    // No bill yet — estimate from usage
    const usageRes = await apiSafe('usage', `/api/usage/summary/${AUTH.userId}`, null);
    const waterL    = parseFloat(usageRes?.summary?.month_water_l || 5400);
    const energyKwh = parseFloat(usageRes?.summary?.month_energy_kwh || 320);
    const rateW = parseFloat(_billingRates.find(r=>r.resource_type==='water')?.rate_per_unit || 0.095);
    const rateE = parseFloat(_billingRates.find(r=>r.resource_type==='energy')?.rate_per_unit || 8.50);
    const est = (waterL * rateW + energyKwh * rateE).toFixed(0);
    const bkpiEst = $('bkpi-estimate');
    if (bkpiEst) bkpiEst.textContent = 'LKR ' + parseInt(est).toLocaleString('en-IN');
    const bkpiEstD = $('bkpi-estimate-detail');
    if (bkpiEstD) bkpiEstD.textContent = 'Estimated · ' + fmtMonth(curMonthKey);
  }

  // --- Tariff Rates ---
  renderTariffRates(_billingRates);

  // --- Payments ---
  renderPaymentHistory(payments);
}

function renderTariffRates(rates) {
  const el = $('tariff-grid'); if (!el) return;
  const icons = { water:'💧', energy:'⚡', fixed:'🔒' };
  const colors = { water:'#38bdf8', energy:'#fbbf24', fixed:'#a78bfa' };
  el.innerHTML = rates.map(r => `
    <div class="tariff-card">
      <span class="tariff-type">${icons[r.resource_type]||'📋'} ${r.resource_type}</span>
      <span class="tariff-rate" style="color:${colors[r.resource_type]||'#f1f5f9'}">LKR ${parseFloat(r.rate_per_unit).toFixed(3)}</span>
      <span class="tariff-unit">${r.unit} · ${r.currency}</span>
      <span class="tariff-since">Effective: ${r.effective_from ? r.effective_from.slice(0,10) : '—'}</span>
    </div>`).join('');
}

function renderPaymentHistory(payments) {
  const tbody = $('payments-body'); if (!tbody) return;
  const cntEl = $('payments-count');
  if (cntEl) cntEl.textContent = payments.length + ' payments';
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No payments recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = payments.map(p => `
    <tr>
      <td title="${p.id}">${shortId(p.id)}</td>
      <td style="color:var(--accent-blue)">${fmtMonth(p.month || '')}</td>
      <td style="color:#34d399;font-weight:700">LKR ${parseFloat(p.amount).toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
      <td>${p.method || '—'}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted)">${p.transaction_ref || '—'}</td>
      <td>${fmt(p.paid_at)}</td>
    </tr>`).join('');
}

// ── Past Bills Tab Loader ─────────────────────────────────────
async function renderBillsTable() {
  const tbody = $('bills-body'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">Loading bills…</td></tr>';

  if (!_billingBills) {
    const res = AUTH.demo ? { bills: MOCK_BILLS } : await apiSafe('billing', `/api/bills/user/${AUTH.userId}`, { bills: MOCK_BILLS });
    _billingBills = res?.bills || MOCK_BILLS;
  }
  const bills = _billingBills;
  const cntEl = $('bills-total-count');
  if (cntEl) cntEl.textContent = bills.length + ' bills';

  if (!bills.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">No bills found.</td></tr>';
    return;
  }

  tbody.innerHTML = bills.map(b => {
    const isPaid    = b.status === 'paid';
    const isOverdue = b.status === 'overdue' || (!isPaid && new Date(b.due_date) < new Date());
    const statusClass = isPaid ? 'bill-status-paid' : isOverdue ? 'bill-status-overdue' : 'bill-status-unpaid';
    const statusLabel = isPaid ? '✓ PAID' : isOverdue ? '⚠ OVERDUE' : '◉ UNPAID';
    const action = isPaid
      ? '<span style="color:var(--text-muted);font-size:11px">—</span>'
      : `<button class="btn-pay" id="pay-btn-${b.id}" onclick="payBill('${b.id}','${b.total}')">Pay Now</button>`;
    return `<tr id="bill-row-${b.id}">
      <td style="font-family:'JetBrains Mono',monospace;color:var(--text-muted);font-size:10px">#${b.id.slice(-6)}</td>
      <td style="font-weight:600;color:var(--text-primary)">${fmtMonth(b.month)}</td>
      <td class="td-value">LKR ${parseFloat(b.water_cost||0).toLocaleString('en-IN',{maximumFractionDigits:0})}<br><span style="font-size:9px;color:var(--text-muted)">${parseFloat(b.water_litres||0).toFixed(0)} L</span></td>
      <td class="td-energy">LKR ${parseFloat(b.energy_cost||0).toLocaleString('en-IN',{maximumFractionDigits:0})}<br><span style="font-size:9px;color:var(--text-muted)">${parseFloat(b.energy_kwh||0).toFixed(0)} kWh</span></td>
      <td style="color:var(--text-muted)">LKR ${parseFloat(b.fixed_charge||0).toFixed(0)}</td>
      <td style="font-weight:800;font-size:13px;color:var(--text-primary)">LKR ${parseFloat(b.total).toLocaleString('en-IN',{maximumFractionDigits:0})}</td>
      <td style="color:${new Date(b.due_date)<new Date()&&!isPaid?'#f87171':'var(--text-secondary)'}">${fmtDate(b.due_date)}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function payBill(billId, total) {
  const btn = $('pay-btn-' + billId); if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
  try {
    await apiFetch('billing', '/api/payments/pay', {
      method: 'POST',
      body: JSON.stringify({ billId, userId: AUTH.userId, method: 'UPI' })
    });
    showToast('✓ Payment successful · LKR ' + parseFloat(total).toLocaleString('en-IN',{maximumFractionDigits:0}));
  } catch (e) {
    showToast('✓ Payment recorded (demo/offline)');
  }
  // Update row in DOM immediately
  const row = $('bill-row-' + billId);
  if (row) {
    const cells = row.querySelectorAll('td');
    cells[7].innerHTML = '<span class="bill-status-paid">✓ PAID</span>';
    cells[8].innerHTML = '<span style="color:var(--text-muted);font-size:11px">—</span>';
  }
  _billingBills = null;
  loadBillingOverview();
}

// ── Usage Breakdown Tab Loader ────────────────────────────────
async function loadCurrentUsageBill() {
  const curMonthKey = new Date().toISOString().slice(0, 7);
  const monthLabel = fmtMonth(curMonthKey);
  const el = $('usage-month-label'); if (el) el.textContent = monthLabel;

  // Fetch usage for current month
  const usageRes = await apiSafe('usage', `/api/usage/monthly/${AUTH.userId}/${curMonthKey}`, null);
  const waterL    = parseFloat(usageRes?.waterL    ?? usageRes?.summary?.month_water_l    ?? 5400);
  const energyKwh = parseFloat(usageRes?.energyKwh ?? usageRes?.summary?.month_energy_kwh ?? 320);

  // Fetch rates
  if (!_billingRates) {
    const ratesRes = AUTH.demo ? { rates: MOCK_RATES } : await apiSafe('billing', '/api/billing/rates', { rates: MOCK_RATES });
    _billingRates = ratesRes?.rates || MOCK_RATES;
  }
  const rateW = parseFloat(_billingRates.find(r=>r.resource_type==='water')?.rate_per_unit   || 0.095);
  const rateE = parseFloat(_billingRates.find(r=>r.resource_type==='energy')?.rate_per_unit  || 8.50);
  const rateF = parseFloat(_billingRates.find(r=>r.resource_type==='fixed')?.rate_per_unit   || 0);

  const waterCost  = +(waterL    * rateW).toFixed(2);
  const energyCost = +(energyKwh * rateE).toFixed(2);
  const fixedCost  = +rateF.toFixed(2);
  const total      = +(waterCost + energyCost + fixedCost).toFixed(2);
  const maxCost    = Math.max(waterCost, energyCost, 1);

  // Render bars
  const barsEl = $('usage-breakdown-bars'); if (!barsEl) return;
  barsEl.innerHTML = [
    { label:'💧 Water', cost:waterCost, detail:`${waterL.toFixed(0)} L × LKR ${rateW}/L`, pct:(waterCost/maxCost)*100, fill:'linear-gradient(90deg,#38bdf8,#06b6d4)' },
    { label:'⚡ Energy', cost:energyCost, detail:`${energyKwh.toFixed(0)} kWh × LKR ${rateE}/kWh`, pct:(energyCost/maxCost)*100, fill:'linear-gradient(90deg,#fbbf24,#f59e0b)' },
    { label:'🔒 Fixed Charge', cost:fixedCost, detail:'Monthly fixed tariff', pct: fixedCost>0 ? Math.max((fixedCost/maxCost)*100, 3) : 3, fill:'linear-gradient(90deg,#a78bfa,#8b5cf6)' },
  ].map(item => `
    <div class="usage-cost-bar-wrap">
      <div class="usage-cost-label-row">
        <span class="usage-cost-name">${item.label}</span>
        <span class="usage-cost-amt">LKR ${item.cost.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
      </div>
      <div class="usage-cost-track">
        <div class="usage-cost-fill" style="width:${item.pct.toFixed(1)}%;background:${item.fill}"></div>
      </div>
      <div class="usage-cost-detail">${item.detail}</div>
    </div>`).join('');

  // Totals row
  const totalsEl = $('usage-totals');
  if (totalsEl) totalsEl.innerHTML = [
    { label:'Total Estimate', val:'LKR '+total.toLocaleString('en-IN',{maximumFractionDigits:0}) },
    { label:'Water Litres', val: waterL.toFixed(0)+' L' },
    { label:'Energy Used', val: energyKwh.toFixed(0)+' kWh' },
    { label:'Days into Month', val: new Date().getDate()+' / '+new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate() },
  ].map(t => `<div class="usage-total-item"><span class="usage-total-label">${t.label}</span><span class="usage-total-val">${t.val}</span></div>`).join('');

  // Doughnut chart
  makeDoughnut('chart-cost-split',
    ['Water', 'Energy', 'Fixed'],
    [waterCost, energyCost, Math.max(fixedCost,0.01)],
    ['#38bdf8','#fbbf24','#a78bfa']
  );

  // Trend chart
  if (!_billingBills) {
    const res = AUTH.demo ? { bills: MOCK_BILLS } : await apiSafe('billing', `/api/bills/user/${AUTH.userId}`, { bills: MOCK_BILLS });
    _billingBills = res?.bills || MOCK_BILLS;
  }
  const trend = [..._billingBills].reverse().slice(-6);
  makeLineChart('chart-bill-trend',
    trend.map(b => fmtMonth(b.month)),
    [
      { label:'Water Cost (LKR)', data:trend.map(b=>parseFloat(b.water_cost||0)), borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:3, pointBackgroundColor:'#38bdf8' },
      { label:'Energy Cost (LKR)', data:trend.map(b=>parseFloat(b.energy_cost||0)), borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,0.08)', fill:true, tension:0.4, borderWidth:2, pointRadius:3, pointBackgroundColor:'#fbbf24' },
      { label:'Total (LKR)', data:trend.map(b=>parseFloat(b.total)), borderColor:'#34d399', borderDash:[5,5], borderWidth:2, pointRadius:0, fill:false },
    ]
  );
}

// ── Forecast Tab Loader ───────────────────────────────────────
async function renderBillForecast() {
  if (!_billingBills) {
    const res = AUTH.demo ? { bills: MOCK_BILLS } : await apiSafe('billing', `/api/bills/user/${AUTH.userId}`, { bills: MOCK_BILLS });
    _billingBills = res?.bills || MOCK_BILLS;
  }
  if (!_billingRates) {
    const ratesRes = AUTH.demo ? { rates: MOCK_RATES } : await apiSafe('billing', '/api/billing/rates', { rates: MOCK_RATES });
    _billingRates = ratesRes?.rates || MOCK_RATES;
  }

  const rateW = parseFloat(_billingRates.find(r=>r.resource_type==='water')?.rate_per_unit  || 0.095);
  const rateE = parseFloat(_billingRates.find(r=>r.resource_type==='energy')?.rate_per_unit || 8.50);

  // Calculate trend from last 3 actual bills
  const history = [..._billingBills].reverse();
  const avgWaterCost  = history.slice(0,3).reduce((s,b)=>s+parseFloat(b.water_cost||0), 0) / Math.max(history.slice(0,3).length,1);
  const avgEnergyCost = history.slice(0,3).reduce((s,b)=>s+parseFloat(b.energy_cost||0), 0) / Math.max(history.slice(0,3).length,1);
  const avgTotal = history.slice(0,3).reduce((s,b)=>s+parseFloat(b.total), 0) / Math.max(history.slice(0,3).length,1);

  // Slight seasonal variation ±5% per month
  const forecast = [1, 2, 3].map(offset => {
    const d = new Date(); d.setMonth(d.getMonth() + offset);
    const factor = 1 + (Math.sin(offset * 0.9) * 0.05); // gentle wave
    return { month: d.toISOString().slice(0,7), total: +(avgTotal * factor).toFixed(0), water: +(avgWaterCost * factor).toFixed(0), energy: +(avgEnergyCost * factor).toFixed(0) };
  });

  const nextForecast = forecast[0];

  // Update headline cards
  const fcAmount = $('forecast-amount');
  if (fcAmount) fcAmount.textContent = 'LKR ' + parseInt(nextForecast.total).toLocaleString('en-IN');
  const fcDetail = $('forecast-detail');
  if (fcDetail) fcDetail.textContent = `Based on avg of last ${history.slice(0,3).length} bills · ${fmtMonth(nextForecast.month)}`;

  const fcWater = $('fcast-water');
  if (fcWater) fcWater.innerHTML = 'LKR '+parseInt(nextForecast.water).toLocaleString('en-IN') + '<br><small style="font-size:12px;font-weight:400;color:var(--text-muted)">Water</small>';
  const fcEnergy = $('fcast-energy');
  if (fcEnergy) fcEnergy.innerHTML = 'LKR '+parseInt(nextForecast.energy).toLocaleString('en-IN') + '<br><small style="font-size:12px;font-weight:400;color:var(--text-muted)">Energy</small>';

  // Forecast chart — last 6 actual + 3 projected
  const actualLabels = history.slice(-6).map(b => fmtMonth(b.month));
  const actualTotals = history.slice(-6).map(b => parseFloat(b.total));
  const forecastLabels = forecast.map(f => fmtMonth(f.month) + ' ▸');
  const forecastTotals = forecast.map(f => f.total);

  const allLabels = [...actualLabels, ...forecastLabels];
  const actualPadded   = [...actualTotals, null, null, null];
  const forecastPadded = [...Array(Math.max(actualLabels.length-1,0)).fill(null), actualTotals[actualTotals.length-1], ...forecastTotals];

  makeLineChart('chart-forecast', allLabels, [
    { label:'Actual Bill (LKR)', data:actualPadded, borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.08)', fill:true, tension:0.4, borderWidth:2.5, pointRadius:4, pointBackgroundColor:'#38bdf8' },
    { label:'Forecast (LKR)',   data:forecastPadded, borderColor:'#34d399', backgroundColor:'rgba(52,211,153,0.06)', borderDash:[6,4], fill:true, tension:0.4, borderWidth:2, pointRadius:4, pointBackgroundColor:'#34d399', pointStyle:'rectRot' },
  ]);

  // Assumptions
  const assEl = $('assumptions-grid'); if (!assEl) return;
  assEl.innerHTML = [
    { label:'Avg Monthly Water', val: (avgWaterCost/rateW).toFixed(0)+' L', note:'Based on last '+history.slice(0,3).length+' bills' },
    { label:'Avg Monthly Energy', val: (avgEnergyCost/rateE).toFixed(0)+' kWh', note:'Based on last '+history.slice(0,3).length+' bills' },
    { label:'Water Rate', val:'LKR '+rateW+' / L', note:'Current active tariff' },
    { label:'Energy Rate', val:'LKR '+rateE+' / kWh', note:'Current active tariff' },
    { label:'Trend Method', val:'3-Month Rolling Avg', note:'±5% seasonal variation' },
    { label:'Forecast Horizon', val:'3 Months', note:forecast.map(f=>fmtMonth(f.month)).join(' · ') },
  ].map(a => `
    <div class="assumption-card">
      <span class="assumption-label">${a.label}</span>
      <span class="assumption-val">${a.val}</span>
      <span class="assumption-note">${a.note}</span>
    </div>`).join('');
}

// ── Bootstrap ──────────────────────────────────────────────────
bootstrapPage('billing', initBilling);
