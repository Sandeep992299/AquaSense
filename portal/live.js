/* =============================================
   AquaSense – Live Telemetry Section
   Dedicated JS module for the Live Telemetry page.
   Depends on: portal.js (globals: $, AUTH, MY_METERS, apiSafe, fmt, shortId, makeLineChart, charts)
   ============================================= */

// ── State ────────────────────────────────────────────────────
let _liveInited     = false;
let _liveMeters     = [];
let _liveFilter     = 'all';
let _liveChartData  = {};       // meterId → [{t, v}]
let _liveChartMeter = 'SMT-W-0041';
let _liveRefreshInterval = null;

// ── Entry Point ───────────────────────────────────────────────
async function initLiveSection() {
  if (_liveInited) return;
  _liveInited = true;

  // Initial data load
  await Promise.all([refreshLiveMeters(), refreshLiveReadings()]);
  initLiveChart(_liveChartMeter);
  renderLiveStats();

  // Auto-refresh every 5 s
  _liveRefreshInterval = setInterval(async () => {
    await Promise.all([refreshLiveMeters(), refreshLiveReadings()]);
    updateLiveChart(_liveChartMeter);
    renderLiveStats();
  }, 5000);
}

// ── Meter Cards ───────────────────────────────────────────────
async function refreshLiveMeters() {
  const data = AUTH.demo
    ? _buildDemoMeters()
    : await apiSafe('usage', '/api/usage/meters');
  _liveMeters = data?.meters || [];
  renderLiveMeterCards(_liveMeters);
}

/** Demo meter data aligned with seed.sql */
function _buildDemoMeters() {
  return { meters: [
    { id:'SMT-W-0041', user_id:'a0000001-0000-0000-0000-000000000001', type:'water',  location:'Kitchen Block, Unit A', status:'online',  unit:'L',   latest_value:174.2, pressure:2.4, last_seen:new Date().toISOString() },
    { id:'SMT-W-0042', user_id:'a0000001-0000-0000-0000-000000000001', type:'water',  location:'Garden Zone South',     status:'online',  unit:'L',   latest_value:91.8,  pressure:1.9, last_seen:new Date(Date.now()-120000).toISOString() },
    { id:'SMT-E-0087', user_id:'a0000001-0000-0000-0000-000000000001', type:'energy', location:'Distribution Board',    status:'online',  unit:'kWh', latest_value:13.6,  pressure:null, last_seen:new Date(Date.now()-60000).toISOString() },
  ]};
}

function renderLiveMeterCards(meters) {
  const el = $('live-meter-cards'); if (!el) return;

  const mine = AUTH.demo
    ? meters
    : meters.filter(m => m.user_id === AUTH.userId || MY_METERS.includes(m.id));

  if (!mine.length) {
    el.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">No meters assigned to your account.</div>';
    return;
  }

  el.innerHTML = mine.map(m => {
    const val  = m.latest_value != null ? parseFloat(m.latest_value).toFixed(2) : '—';
    const unit = m.unit || (m.type === 'water' ? 'L' : 'kWh');
    const pulseDot = m.status === 'online' ? '<span class="live-pulse-dot"></span>' : '';
    const statusColor = { online:'#34d399', warning:'#fbbf24', offline:'#f87171' }[m.status] || '#94a3b8';
    return `
      <div class="live-meter-card ${m.type}" id="lmc-${m.id}">
        <div class="lmc-header">
          <span class="lmc-id">${m.id}</span>
          <span class="lmc-status ${m.status}" style="color:${statusColor}">
            ${pulseDot}<span class="lmc-status-dot" style="background:${statusColor}"></span>${m.status.toUpperCase()}
          </span>
        </div>
        <div class="lmc-value ${m.type}">${val}</div>
        <div class="lmc-unit">${unit} — ${m.type === 'water' ? 'Flow Reading' : 'Power Draw'}</div>
        <div class="lmc-location">📍 ${m.location || '—'}</div>
        ${m.pressure != null ? `<div class="lmc-pressure">⦿ Pressure: <strong>${m.pressure}</strong> bar</div>` : ''}
        <div class="lmc-chart-btn">
          <button class="lmc-switch-btn" onclick="switchLiveChartMeter('${m.id}')">
            ${_liveChartMeter === m.id ? '📈 Viewing' : '📈 View Chart'}
          </button>
        </div>
        ${m.last_seen
          ? `<div class="lmc-last-seen">Last seen: ${fmt(m.last_seen)}</div>`
          : '<div class="lmc-last-seen">No data yet</div>'}
      </div>`;
  }).join('');
}

// ── Readings Table ────────────────────────────────────────────
let _liveReadingsCache = [];

async function refreshLiveReadings() {
  if (AUTH.demo) {
    _liveReadingsCache = _buildDemoReadings();
    // Build chart data from demo readings
    MY_METERS.forEach(mid => {
      const rows = _liveReadingsCache.filter(r => r.meter_id === mid);
      _liveChartData[mid] = rows.slice().reverse().map(r => ({
        t: new Date(r.recorded_at).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
        v: parseFloat(r.value)
      }));
    });
    renderLiveReadingsTable();
    return;
  }

  const promises = MY_METERS.map(mid =>
    apiSafe('usage', `/api/usage/readings/${mid}?limit=20`)
  );
  const results = await Promise.all(promises);

  _liveReadingsCache = [];
  results.forEach(r => { if (r?.data) _liveReadingsCache.push(...r.data); });
  _liveReadingsCache.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));

  // Build chart data per meter
  MY_METERS.forEach((mid, i) => {
    const rows = results[i]?.data || [];
    _liveChartData[mid] = rows.slice().reverse().map(r => ({
      t: new Date(r.recorded_at).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
      v: parseFloat(r.value)
    }));
  });

  renderLiveReadingsTable();
}

/** Generate realistic demo readings from seed data */
function _buildDemoReadings() {
  const readings = [];
  const baseValues = {
    'SMT-W-0041': { avg:174, noise:20, unit:'L',   type:'water',  pressure:true  },
    'SMT-W-0042': { avg:91,  noise:12, unit:'L',   type:'water',  pressure:true  },
    'SMT-E-0087': { avg:13.6,noise:2,  unit:'kWh', type:'energy', pressure:false },
  };
  const now = Date.now();
  MY_METERS.forEach(mid => {
    const cfg = baseValues[mid];
    for (let i = 19; i >= 0; i--) {
      const t   = new Date(now - i * 4 * 60 * 1000);   // every 4 min
      const val = +(cfg.avg + (Math.random() - 0.5) * cfg.noise * 2).toFixed(3);
      readings.push({
        id:          'demo-' + mid + '-' + i,
        meter_id:    mid,
        type:        cfg.type,
        value:       val,
        unit:        cfg.unit,
        pressure:    cfg.pressure ? +(2.1 + Math.random() * 0.6).toFixed(2) : null,
        quality:     Math.random() < 0.05 ? 'anomaly' : 'normal',
        recorded_at: t.toISOString(),
      });
    }
  });
  return readings.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
}

function filterLiveReadings(type, btn) {
  _liveFilter = type;
  document.querySelectorAll('[id^="live-filter-"]').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderLiveReadingsTable();
}

function renderLiveReadingsTable() {
  const tbody = $('live-readings-body'); if (!tbody) return;
  const rows = _liveFilter === 'all'
    ? _liveReadingsCache
    : _liveReadingsCache.filter(r => r.type === _liveFilter);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No readings yet — start the simulator to stream data</td></tr>';
    return;
  }

  tbody.innerHTML = rows.slice(0, 40).map(r => `
    <tr class="${r.quality === 'anomaly' ? 'row-anomaly' : ''}">
      <td title="${r.id}">${shortId(r.id)}</td>
      <td style="color:var(--accent-blue);font-weight:600">${r.meter_id}</td>
      <td>${r.type}</td>
      <td class="${r.type === 'energy' ? 'td-energy' : 'td-value'}">${parseFloat(r.value).toFixed(3)} ${r.unit || ''}</td>
      <td class="td-pressure">${r.pressure != null ? r.pressure + ' bar' : '—'}</td>
      <td class="${r.quality === 'anomaly' ? 'td-q-anomaly' : 'td-q-normal'}">${r.quality}</td>
      <td>${fmt(r.recorded_at)}</td>
    </tr>`).join('');
}

// ── Live Real-Time Chart ──────────────────────────────────────
function initLiveChart(meterId) {
  const data   = _liveChartData[meterId] || _buildFallbackChartData(meterId);
  const labels = data.map(d => d.t);
  const vals   = data.map(d => d.v);
  const color  = meterId === 'SMT-E-0087' ? '#fbbf24' : '#38bdf8';
  const unit   = meterId === 'SMT-E-0087' ? 'kWh' : 'L';

  makeLineChart('chart-live-flow', labels, [{
    label: `${meterId} — ${unit}`,
    data: vals,
    borderColor: color,
    backgroundColor: color + '1a',
    fill: true,
    tension: 0.4,
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: color,
    pointHoverRadius: 5,
  }], {
    animation: { duration: 300 },
    plugins: {
      legend: { labels: { color:'#94a3b8', font:{ size:11 }, boxWidth:12 } },
      tooltip: { callbacks: {
        label: ctx => ` ${ctx.parsed.y.toFixed(2)} ${unit}`
      }}
    },
    scales: {
      x: { ticks:{ color:'#4a5568', font:{size:10}, maxTicksLimit:10 }, grid:{ color:'rgba(255,255,255,0.04)' } },
      y: { ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' },
           title:{ display:true, text:unit, color:'#4a5568', font:{size:10} } }
    }
  });
  // Update button state
  document.querySelectorAll('.lmc-switch-btn').forEach((btn, i) => {
    btn.textContent = MY_METERS[i] === meterId ? '📈 Viewing' : '📈 View Chart';
  });
}

function updateLiveChart(meterId) {
  const data = _liveChartData[meterId];
  if (!data?.length) return;
  const ch = charts['chart-live-flow'];
  if (!ch) { initLiveChart(meterId); return; }
  ch.data.labels = data.map(d => d.t);
  ch.data.datasets[0].data = data.map(d => d.v);
  ch.update('none');
}

function switchLiveChartMeter(meterId) {
  _liveChartMeter = meterId;
  initLiveChart(meterId);
}

/** Fallback chart data using seed-derived values when no API data */
function _buildFallbackChartData(meterId) {
  const isEnergy = meterId === 'SMT-E-0087';
  const base     = isEnergy ? 13.6 : (meterId === 'SMT-W-0042' ? 91 : 174);
  const noise    = isEnergy ? 2    : (meterId === 'SMT-W-0042' ? 12 : 20);
  const now      = Date.now();
  return Array.from({ length: 20 }, (_, i) => {
    const t = new Date(now - (19 - i) * 4 * 60 * 1000);
    return {
      t: t.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
      v: +(base + (Math.random() - 0.5) * noise * 2).toFixed(2)
    };
  });
}

// ── Stats Row ─────────────────────────────────────────────────
function renderLiveStats() {
  const totalReadings  = _liveReadingsCache.length;
  const anomalies      = _liveReadingsCache.filter(r => r.quality === 'anomaly').length;
  const onlineMeters   = _liveMeters.filter(m =>
    MY_METERS.includes(m.id) && m.status === 'online'
  ).length;

  const elReadings = $('live-stat-readings');
  const elAnomalies = $('live-stat-anomalies');
  const elOnline   = $('live-stat-online');
  if (elReadings)  elReadings.textContent  = totalReadings;
  if (elAnomalies) elAnomalies.textContent = anomalies;
  if (elOnline)    elOnline.textContent    = onlineMeters + ' / ' + MY_METERS.length;
}
