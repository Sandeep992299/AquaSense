/* =============================================
   AquaSense – Dashboard Page JS
   Depends on: shared.js
   ============================================= */

const ALERT_ICON = { critical:'🚨', warning:'⚠️', info:'📋' };

// ── Dashboard Data ─────────────────────────────────────────────
async function loadDashboardData() {
  // Water KPI
  const usageRes = await apiSafe('usage', `/api/usage/readings/SMT-W-0041?limit=10`);
  const latestW  = usageRes?.data?.[0];
  const waterToday = latestW ? Math.round(parseFloat(latestW.value) * 1.6) : MOCK.waterToday;
  animCount('kpi-water', 0, waterToday, 'L', 800);

  // Energy KPI
  const engRes   = await apiSafe('usage', `/api/usage/readings/SMT-E-0087?limit=10`);
  const latestE  = engRes?.data?.[0];
  const energyToday = latestE ? parseFloat(latestE.value) : MOCK.energyToday;
  animCount('kpi-energy', 0, energyToday, 'kWh', 800, 1);

  // Pressure KPI
  const pressure = latestW?.pressure || MOCK.pressure;
  const kpiP = $('kpi-pressure');
  if (kpiP) kpiP.innerHTML = `${parseFloat(pressure).toFixed(1)} <small>bar</small>`;

  // Sparklines
  makeSparkline('spark-water',    MOCK.waterDays30['SMT-W-0041'].slice(-14), '#38bdf8');
  makeSparkline('spark-energy',   MOCK.energyDays30.slice(-14),              '#fbbf24');
  makeSparkline('spark-pressure', MOCK.pressureHours.slice(-14),             '#a78bfa');

  // Billing
  const billsData = await apiSafe('billing', `/api/billing/bills/user/${AUTH.userId || ''}`);
  const latestBill = billsData?.bills?.find(b => b.status !== 'paid') || billsData?.bills?.[0];
  const billTotal  = latestBill ? parseFloat(latestBill.total) : MOCK.bill;
  const kpiBill = $('kpi-bill');
  if (kpiBill) kpiBill.innerHTML = `LKR ${billTotal.toLocaleString('en-IN', { maximumFractionDigits:0 })}`;
  makeSparkline('spark-bill',
    (billsData?.bills || []).slice(0,7).map(b => parseFloat(b.total)).reverse() ||
    MOCK.energyDays30.slice(-7).map(v => v * 310), '#34d399');

  // Alerts
  const alertsData = await apiSafe('alert', `/api/alerts/user/${AUTH.userId || ''}`);
  const badge = $('alert-badge');
  if (badge) badge.textContent = alertsData?.alerts?.filter(a => a.status==='active').length ?? MOCK.alerts.length;
  renderDashboardAlerts(alertsData?.alerts || null);
}

// ── Charts ─────────────────────────────────────────────────────
function renderWaterChart(days) {
  const labels = [];
  const d = new Date();
  for (let i = days-1; i >= 0; i--) {
    const t = new Date(d); t.setDate(d.getDate()-i);
    labels.push(t.toLocaleDateString('en-IN', { weekday:'short', day:'numeric' }));
  }
  const kitchen = MOCK.waterDays30['SMT-W-0041'].slice(-days);
  const garden  = MOCK.waterDays30['SMT-W-0042'].slice(-days);
  makeLineChart('chart-water-usage', labels, [
    { label:'Kitchen (L)', data:kitchen, borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:3, pointBackgroundColor:'#38bdf8' },
    { label:'Garden (L)',  data:garden,  borderColor:'#06b6d4', backgroundColor:'rgba(6,182,212,0.07)',  fill:true, tension:0.4, borderWidth:1.5, pointRadius:0 },
    { label:'Target (L)',  data:Array(days).fill(300), borderColor:'rgba(52,211,153,0.4)', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false }
  ]);
}

function setWaterRange(days, btn) {
  document.querySelectorAll('.chart-controls .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderWaterChart(days);
}

function renderBreakdownChart() {
  makeDoughnut('chart-breakdown',
    ['Kitchen','Bathroom','Garden','Laundry'],
    [31, 44, 15, 10],
    ['#38bdf8','#06b6d4','#34d399','#a78bfa']);
}

// ── Live Feed ──────────────────────────────────────────────────
const feedEvents = [
  { msg:'Flow sensor SMT-W-0041 reading normal',          color:'#34d399' },
  { msg:'Pressure @ Kitchen Block: 2.4 bar – OK',         color:'#38bdf8' },
  { msg:'Smart meter SMT-W-0042 data synced to RDS',      color:'#a78bfa' },
  { msg:'IoT Core rule triggered → usage-service',        color:'#38bdf8' },
  { msg:'Lambda anomaly-detector invoked (OK)',            color:'#fbbf24' },
  { msg:'Aurora DB heartbeat confirmed',                   color:'#34d399' },
  { msg:'SNS alert dispatched to endpoint',               color:'#fb923c' },
  { msg:'ECS task aqua-usage-svc healthy',                color:'#34d399' },
  { msg:'SMT-E-0087 energy reading ingested',             color:'#fbbf24' },
  { msg:'CloudWatch alarm OK state',                      color:'#34d399' },
];
let feedIdx = 0;
function addFeedItem() {
  const feed = $('live-feed'); if (!feed) return;
  const ev   = feedEvents[feedIdx++ % feedEvents.length];
  const now  = new Date().toLocaleTimeString('en-IN');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `<span class="feed-dot" style="background:${ev.color};box-shadow:0 0 6px ${ev.color}"></span>
    <span>${ev.msg}</span><span class="feed-meta">${now}</span>`;
  feed.insertBefore(item, feed.firstChild);
  if (feed.children.length > 8) feed.lastChild.remove();
}

// ── Alerts ─────────────────────────────────────────────────────
function renderDashboardAlerts(alerts) {
  const el = $('dashboard-alerts'); if (!el) return;
  el.innerHTML = '';
  (alerts || MOCK.alerts).slice(0, 3).forEach(a => {
    el.innerHTML += `<div class="alert-item ${a.severity}">
      <span class="alert-icon">${ALERT_ICON[a.severity] || '📌'}</span>
      <div class="alert-body">
        <div class="alert-title">${a.title}</div>
        <div class="alert-time">${timeAgo(a.created_at)}</div>
      </div></div>`;
  });
}

// ── Page Init ──────────────────────────────────────────────────
function initDashboard() {
  renderWaterChart(7);
  renderBreakdownChart();
  addFeedItem();
  setInterval(addFeedItem, 2800);
  loadDashboardData();
  if (!AUTH.demo) setInterval(loadDashboardData, 30000);
}

bootstrapPage('dashboard', initDashboard);
