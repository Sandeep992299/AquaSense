/* =============================================
   AquaSense – Energy Monitor Page JS
   Depends on: shared.js, sidebar.js
   ============================================= */

// ── Energy Appliance Breakdown data ────────────────────────────
const APPLIANCES = [
  { name:'Air Conditioner (1.5 ton)', icon:'❄️',  kWh: 5.8,  pct: 41 },
  { name:'Water Heater',              icon:'🌡️', kWh: 2.9,  pct: 20 },
  { name:'Refrigerator',             icon:'🧊',  kWh: 1.8,  pct: 13 },
  { name:'Washing Machine',          icon:'🫧',  kWh: 1.2,  pct: 8  },
  { name:'Lighting (LED)',           icon:'💡',  kWh: 0.9,  pct: 6  },
  { name:'Ceiling Fans (×4)',        icon:'🌀',  kWh: 0.7,  pct: 5  },
  { name:'Miscellaneous',            icon:'🔌',  kWh: 1.0,  pct: 7  },
];

const ENERGY_TIPS = [
  { icon:'❄️',  title:'Raise AC by 2°C',     desc:'Setting AC from 18°C to 20°C reduces compressor load by ~10%, saving energy with minimal comfort impact.', saving:'Save ~LKR 120/month' },
  { icon:'⏰',  title:'Shift to Off-Peak Hours', desc:'Run high-draw appliances (washing machine, water heater) between 10 PM–6 AM to benefit from lower CEB tariffs.', saving:'Save ~LKR 180/month' },
  { icon:'🌞',  title:'Enable Solar Peak Harvest', desc:'Your SMT-E-0087 meter supports net metering. During peak solar hours (11 AM–3 PM), limit grid draw.', saving:'Save ~LKR 250/month' },
  { icon:'🔌',  title:'Unplug Standby Devices',   desc:'TV, microwave, and chargers in standby consume 5–15 W continuously. Unplugging saves 30–80 kWh/year.', saving:'Save ~LKR 60/month' },
];

// ── Page Init ──────────────────────────────────────────────────
async function initEnergy() {
  renderSidebar('energy');
  await loadEnergyKPIs();
  renderHourlyChart();
  renderEnergyMixChart();
  render30DayTrend();
  renderApplianceTable();
  renderEnergyTips();
}

// ── KPIs ───────────────────────────────────────────────────────
async function loadEnergyKPIs() {
  // Try to get today's live reading
  const res = await apiSafe('usage', '/api/usage/readings/SMT-E-0087?limit=20');

  const today = new Date().toDateString();
  const todayReadings = res?.data?.filter(r => new Date(r.recorded_at).toDateString() === today) || [];
  const todayTotal = todayReadings.reduce((s, r) => s + parseFloat(r.value), 0) || MOCK.energyToday;
  const latestReading = res?.data?.[0];

  // Today usage
  const kpiToday = $('kpi-energy-today');
  if (kpiToday) animCount('kpi-energy-today', 0, todayTotal, 'kWh', 800, 1);

  // Monthly estimate
  const dayOfMonth = new Date().getDate();
  const monthlyEst = +(todayTotal * (30 / Math.max(dayOfMonth, 1))).toFixed(1);
  animCount('kpi-energy-monthly', 0, monthlyEst, 'kWh', 800, 1);

  // Current draw
  const currentDraw = latestReading ? parseFloat(latestReading.value) : 13.6;
  animCount('kpi-energy-current', 0, currentDraw, 'kWh', 800, 1);

  // Cost estimate (LKR 8.50/kWh)
  const monthlyCost = +(monthlyEst * 8.5).toFixed(0);
  const kpiCost = $('kpi-energy-cost');
  if (kpiCost) kpiCost.innerHTML = `LKR ${monthlyCost.toLocaleString('en-IN')}`;

  // Sparklines
  makeSparkline('spark-today',   MOCK.energyDays30.slice(-14), '#fbbf24');
  makeSparkline('spark-monthly', MOCK.energyDays30.slice(-14).map(v => v * 30), '#f59e0b');
  makeSparkline('spark-current', MOCK.pressureHours.slice(-14).map(v => v * 5.5), '#fb923c');
}

// ── Hourly Chart ───────────────────────────────────────────────
async function renderHourlyChart() {
  const res = await apiSafe('usage', '/api/usage/readings/SMT-E-0087?limit=120');
  const hours = Array.from({ length: 24 }, (_, i) => i + ':00');

  let hourlyData;
  if (res?.data?.length) {
    const today = new Date().toDateString();
    const todayReadings = res.data.filter(r => new Date(r.recorded_at).toDateString() === today);
    if (todayReadings.length >= 3) {
      hourlyData = Array(24).fill(null);
      todayReadings.forEach(r => { hourlyData[new Date(r.recorded_at).getHours()] = parseFloat(r.value); });
      const avg = todayReadings.reduce((s, r) => s + parseFloat(r.value), 0) / todayReadings.length;
      hourlyData = hourlyData.map(v => v ?? +(avg * (0.8 + Math.random() * 0.4)).toFixed(2));
    }
  }
  if (!hourlyData) {
    hourlyData = MOCK.pressureHours.map(v => +(v * 1.5 + Math.random() * 0.5).toFixed(2));
  }

  makeLineChart('chart-energy-hourly', hours, [{
    label: 'kWh (hourly)',
    data: hourlyData,
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251,191,36,0.1)',
    fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0
  }], {
    plugins: {
      legend: { labels: { color:'#94a3b8', font:{size:11}, boxWidth:12 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(2)} kWh` } }
    },
    scales: {
      x: { ticks:{color:'#4a5568',font:{size:10},maxTicksLimit:12}, grid:{color:'rgba(255,255,255,0.04)'} },
      y: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'},
           title:{display:true, text:'kWh', color:'#4a5568', font:{size:10}} }
    }
  });
}

// ── Energy Mix Doughnut ────────────────────────────────────────
function renderEnergyMixChart() {
  makeDoughnut('chart-energy-mix',
    ['Grid (CEB)', 'Solar', 'Off-Peak', 'Battery'],
    [58, 20, 15, 7],
    ['#fbbf24', '#34d399', '#38bdf8', '#fb923c']);
}

// ── 30-Day Trend ───────────────────────────────────────────────
function render30DayTrend() {
  const labels = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 29 + i);
    return d.getDate() + '/' + d.toLocaleString('en-IN', { month:'short' });
  });

  const avg = MOCK.energyDays30.reduce((a,b) => a+b,0) / MOCK.energyDays30.length;
  makeLineChart('chart-energy-30d', labels, [
    { label:'Daily kWh', data: MOCK.energyDays30, borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
    { label:'Average',   data: Array(30).fill(+avg.toFixed(1)), borderColor:'rgba(52,211,153,0.5)', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false },
    { label:'Target',    data: Array(30).fill(12), borderColor:'rgba(248,113,113,0.4)', borderDash:[4,4], borderWidth:1, pointRadius:0, fill:false }
  ]);
}

// ── Appliance Table ────────────────────────────────────────────
function renderApplianceTable() {
  const tbody = $('appliance-tbody'); if (!tbody) return;
  const maxKWh = Math.max(...APPLIANCES.map(a => a.kWh));
  tbody.innerHTML = APPLIANCES.map(a => `
    <tr>
      <td>${a.icon} ${a.name}</td>
      <td style="color:var(--accent-yellow);font-weight:600;font-family:'JetBrains Mono',monospace">${a.kWh.toFixed(1)} kWh</td>
      <td class="usage-bar-cell">
        <div class="usage-bar-wrap"><div class="usage-bar-fill" style="width:${(a.kWh/maxKWh*100).toFixed(0)}%"></div></div>
      </td>
      <td style="color:var(--text-secondary)">${a.pct}%</td>
      <td style="color:var(--accent-green);font-weight:600;font-family:'JetBrains Mono',monospace">LKR ${(a.kWh * 8.5).toFixed(2)}</td>
    </tr>`).join('');
}

// ── Tips Grid ──────────────────────────────────────────────────
function renderEnergyTips() {
  const grid = $('tips-grid'); if (!grid) return;
  grid.innerHTML = ENERGY_TIPS.map(t => `
    <div class="tip-card">
      <div class="tip-icon">${t.icon}</div>
      <div>
        <div class="tip-title">${t.title}</div>
        <div class="tip-desc">${t.desc}</div>
        <div class="tip-saving">${t.saving}</div>
      </div>
    </div>`).join('');
}

// ── Bootstrap ──────────────────────────────────────────────────
bootstrapPage('energy', initEnergy);
