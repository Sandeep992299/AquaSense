/* =============================================
   AquaSense – Water Usage Page JS
   Depends on: shared.js, sidebar.js
   ============================================= */

// ── Page Init ──────────────────────────────────────────────────
async function initWater() {
  renderSidebar('water');
  await loadWaterData();
}

// ── Load & Render Water Data ──────────────────────────────────
async function loadWaterData() {
  // Fetch real 30-day readings from API; fall back to seed-derived MOCK data
  const [kitchenRes, gardenRes] = await Promise.all([
    apiSafe('usage', `/api/usage/readings/SMT-W-0041?limit=180`),
    apiSafe('usage', `/api/usage/readings/SMT-W-0042?limit=120`),
  ]);

  // Build 30 day labels
  const months30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 29 + i);
    return d.getDate() + '/' + d.toLocaleString('en-IN', { month:'short' });
  });

  // Aggregate API readings by day
  function aggregateByDay(rows, days) {
    if (!rows?.length) return null;
    const buckets = {};
    rows.forEach(r => {
      const day = new Date(r.recorded_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
      buckets[day] = (buckets[day] || 0) + parseFloat(r.value);
    });
    const d = new Date();
    return Array.from({ length: days }, (_, i) => {
      const t = new Date(d); t.setDate(d.getDate() - (days - 1) + i);
      const key = t.getDate() + '/' + t.toLocaleString('en-IN', { month:'short' });
      return buckets[key] ?? null;
    });
  }

  const kitchenLive = aggregateByDay(kitchenRes?.data, 30);
  const gardenLive  = aggregateByDay(gardenRes?.data,  30);
  const kitchenData = kitchenLive || MOCK.waterDays30['SMT-W-0041'];
  const gardenData  = gardenLive  || MOCK.waterDays30['SMT-W-0042'];

  // Combined daily totals
  const combined = kitchenData.map((k, i) => (k || 0) + (gardenData[i] || 0));

  // Today's usage
  const today = new Date().toDateString();
  const kitchenTodayReadings = kitchenRes?.data?.filter(r => new Date(r.recorded_at).toDateString() === today) || [];
  const gardenTodayReadings  = gardenRes?.data?.filter(r => new Date(r.recorded_at).toDateString() === today) || [];
  const kitchenToday = kitchenTodayReadings.reduce((s, r) => s + parseFloat(r.value), 0);
  const gardenToday  = gardenTodayReadings.reduce((s, r) => s + parseFloat(r.value), 0);
  const todayTotal = (kitchenToday + gardenToday) || MOCK.waterToday;

  // Monthly stats
  const monthlyTotal = combined.reduce((s, v) => s + v, 0);
  const dailyAvg     = monthlyTotal / 30;
  const LKR_RATE_WATER = 9.50; // LKR per 1000 L (approx NWSDB slab)
  const monthlyCostLKR = (monthlyTotal / 1000) * LKR_RATE_WATER;

  // Update KPI cards
  const kpiToday = $('kpi-water-today');
  if (kpiToday) animCount('kpi-water-today', 0, todayTotal, 'L', 800, 0);

  const kpiMonthly = $('kpi-water-monthly');
  if (kpiMonthly) animCount('kpi-water-monthly', 0, monthlyTotal, 'L', 800, 0);

  const kpiPressure = $('kpi-water-pressure');
  const latestPressure = kitchenRes?.data?.[0]?.pressure ?? MOCK.pressure;
  if (kpiPressure) animCount('kpi-water-pressure', 0, parseFloat(latestPressure), 'bar', 800, 1);

  const kpiCost = $('kpi-water-cost');
  if (kpiCost) kpiCost.innerHTML = `LKR ${monthlyCostLKR.toLocaleString('en-IN', {maximumFractionDigits:0})}`;

  // Update stats grid
  const elMonthly = $('water-stat-monthly');
  const elAvg     = $('water-stat-avg');
  const elCost    = $('water-stat-cost');
  if (elMonthly) elMonthly.textContent = monthlyTotal.toFixed(0) + ' L';
  if (elAvg)     elAvg.textContent     = dailyAvg.toFixed(0) + ' L';
  if (elCost)    elCost.textContent    = 'LKR ' + monthlyCostLKR.toFixed(0);

  // Sparklines
  makeSparkline('spark-today', combined.slice(-14), '#38bdf8');
  makeSparkline('spark-monthly', combined.slice(-14).map(v => v * 30), '#0ea5e9');
  makeSparkline('spark-pressure', MOCK.pressureHours.slice(-14), '#a78bfa');

  // Daily consumption chart
  makeLineChart('chart-water-detail', months30, [
    { label:'Kitchen (L)',  data: kitchenData, borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.12)', fill:true, tension:0.4, borderWidth:2, pointRadius:2, pointBackgroundColor:'#38bdf8' },
    { label:'Garden (L)',   data: gardenData,  borderColor:'#06b6d4', backgroundColor:'rgba(6,182,212,0.07)',  fill:true, tension:0.4, borderWidth:1.5, pointRadius:0 },
    { label:'Total (L)',    data: combined,    borderColor:'rgba(52,211,153,0.7)', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false },
    { label:'Target (L)',   data: Array(30).fill(270), borderColor:'rgba(248,113,113,0.4)', borderDash:[3,3], borderWidth:1, pointRadius:0, fill:false },
  ], {
    plugins: {
      legend: { labels: { color:'#94a3b8', font:{size:11}, boxWidth:12 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)} L` } }
    },
    scales: {
      x: { ticks:{color:'#4a5568',font:{size:10},maxTicksLimit:12}, grid:{color:'rgba(255,255,255,0.04)'} },
      y: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'},
           title:{display:true,text:'Litres',color:'#4a5568',font:{size:10}} }
    }
  });

  // Pressure chart
  const hours = Array.from({ length: 24 }, (_, i) => i + ':00');
  makeLineChart('chart-pressure', hours, [
    { label:'Pressure (bar)', data: MOCK.pressureHours, borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 }
  ]);
}

// ── Bootstrap ──────────────────────────────────────────────────
bootstrapPage('water', initWater);
