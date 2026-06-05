/* =============================================
   AquaSense – Data Management (CRUD) Section
   Dedicated JS module for the Data Management page.
   Depends on: portal.js (globals: $, AUTH, apiSafe, apiFetch, fmt, shortId, timeAgo, showToast,
               makeLineChart, makeDoughnut, charts, MOCK)
   ============================================= */

// ── State ────────────────────────────────────────────────────
let _crudTab          = 'readings';
let _crudReadingsPage = 1;

// ── Entry Point ───────────────────────────────────────────────
function initCrudSection() {
  if (typeof renderSidebar === 'function') renderSidebar('crud');
  switchCrudTab(_crudTab);
  renderCrudSummaryChart();
}

function switchCrudTab(tab) {
  _crudTab = tab;
  document.querySelectorAll('.crud-tab').forEach(t  => t.classList.remove('active'));
  document.querySelectorAll('.crud-panel').forEach(p => p.classList.remove('active'));
  $('crud-tab-' + tab)?.classList.add('active');
  $('crud-panel-' + tab)?.classList.add('active');
  if (tab === 'readings') loadCrudReadings();
  if (tab === 'meters')   loadCrudMeters();
  if (tab === 'alerts')   loadCrudAlerts();
}

// ── Summary Chart (shown at top of CRUD page) ─────────────────
async function renderCrudSummaryChart() {
  const canvas = $('chart-crud-summary');
  if (!canvas) return;

  // Fetch recent readings for a quick volume bar chart
  const res = await apiSafe('usage', '/api/usage/meters');
  const meters = res?.meters || [];

  const mine = AUTH.demo
    ? [
        { id:'SMT-W-0041', type:'water',  latest_value:174.2, unit:'L',   status:'online'  },
        { id:'SMT-W-0042', type:'water',  latest_value:91.8,  unit:'L',   status:'online'  },
        { id:'SMT-E-0087', type:'energy', latest_value:13.6,  unit:'kWh', status:'online'  },
      ]
    : meters;

  if (!mine.length) return;

  const labels = mine.map(m => m.id);
  const values = mine.map(m => parseFloat(m.latest_value || 0));
  const colors = mine.map(m => m.type === 'energy' ? '#fbbf24' : '#38bdf8');
  const units  = mine.map(m => m.unit || (m.type === 'energy' ? 'kWh' : 'L'));

  const ctx = canvas.getContext('2d'); if (!ctx) return;
  if (charts['chart-crud-summary']) charts['chart-crud-summary'].destroy();
  charts['chart-crud-summary'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Latest Reading',
        data: values,
        backgroundColor: colors.map(c => c + '33'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (ctx) => ` ${ctx.parsed.y.toFixed(2)} ${units[ctx.dataIndex]}`
        }}
      },
      scales: {
        x: { ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y: { ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' } }
      },
      responsive: true,
      maintainAspectRatio: true,
    }
  });
}

// ── READINGS CRUD ─────────────────────────────────────────────
async function loadCrudReadings() {
  const tbody   = $('crud-readings-body'); if (!tbody) return;
  const meterId = $('crud-meter-filter')?.value || 'SMT-W-0041';
  const limit   = parseInt($('crud-readings-limit')?.value || '20');

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Loading…</td></tr>';

  const data  = await apiSafe('usage', `/api/usage/readings/${meterId}?limit=${limit}&page=${_crudReadingsPage}`);
  const rows  = data?.data || [];
  const total = data?.total || rows.length;

  const countEl = $('readings-count');
  if (countEl) countEl.textContent = total + ' total';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No readings found for this meter.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr id="row-${r.id}" class="${r.quality === 'anomaly' ? 'row-anomaly' : ''}">
      <td title="${r.id}">${shortId(r.id)}</td>
      <td style="color:var(--accent-blue);font-weight:600">${r.meter_id}</td>
      <td><span class="type-badge ${r.type}">${r.type}</span></td>
      <td class="${r.type === 'energy' ? 'td-energy' : 'td-value'}">${parseFloat(r.value).toFixed(3)} <small>${r.unit||''}</small></td>
      <td class="td-pressure">${r.pressure != null ? r.pressure + ' bar' : '—'}</td>
      <td class="${r.quality === 'anomaly' ? 'td-q-anomaly' : 'td-q-normal'}">${r.quality}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted)">${fmt(r.recorded_at)}</td>
      <td>
        <button class="btn-edit"   onclick='openEditReading(${JSON.stringify(r)})'>Edit</button>
        <button class="btn-delete" onclick="deleteReading('${r.id}')">Delete</button>
      </td>
    </tr>`).join('');

  // Pagination
  const pageCount = Math.ceil(total / limit);
  const pag = $('crud-readings-pagination');
  if (pag) {
    pag.innerHTML = '';
    if (pageCount > 1) {
      // Prev button
      if (_crudReadingsPage > 1) {
        const prev = document.createElement('button');
        prev.className = 'crud-page-btn'; prev.textContent = '‹';
        prev.onclick = () => { _crudReadingsPage--; loadCrudReadings(); };
        pag.appendChild(prev);
      }
      for (let i = 1; i <= Math.min(pageCount, 8); i++) {
        const btn = document.createElement('button');
        btn.className = 'crud-page-btn' + (i === _crudReadingsPage ? ' active' : '');
        btn.textContent = i;
        btn.onclick = () => { _crudReadingsPage = i; loadCrudReadings(); };
        pag.appendChild(btn);
      }
      // Next button
      if (_crudReadingsPage < pageCount) {
        const next = document.createElement('button');
        next.className = 'crud-page-btn'; next.textContent = '›';
        next.onclick = () => { _crudReadingsPage++; loadCrudReadings(); };
        pag.appendChild(next);
      }
    }
  }
}

// CREATE Reading
function openCreateReading() {
  const meterId = $('crud-meter-filter')?.value || 'SMT-W-0041';
  openModal('➕ Ingest New Reading', `
    <form class="crud-form" id="form-create-reading">
      <div class="crud-form-row">
        <label>Meter ID</label>
        <select id="cr-meter">
          <option value="SMT-W-0041">SMT-W-0041 – Kitchen Water</option>
          <option value="SMT-W-0042">SMT-W-0042 – Garden Water</option>
          <option value="SMT-E-0087">SMT-E-0087 – Energy Board</option>
        </select>
      </div>
      <div class="crud-form-row">
        <label>Value</label>
        <input type="number" id="cr-value" step="0.001" min="0" placeholder="e.g. 12.5" required />
      </div>
      <div class="crud-form-row" id="cr-pressure-row">
        <label>Pressure (bar) — water only</label>
        <input type="number" id="cr-pressure" step="0.1" min="0" max="10" placeholder="e.g. 2.4" />
      </div>
      <div class="crud-form-actions">
        <button type="button" class="crud-btn-submit" onclick="submitCreateReading()">Ingest Reading</button>
        <button type="button" class="crud-btn-cancel" onclick="closeCrudModal()">Cancel</button>
      </div>
    </form>`);
  $('cr-meter').value = meterId;
  $('cr-meter').onchange = () => {
    $('cr-pressure-row').style.display = $('cr-meter').value !== 'SMT-E-0087' ? 'flex' : 'none';
  };
}

async function submitCreateReading() {
  const meterId  = $('cr-meter').value;
  const value    = parseFloat($('cr-value').value);
  const pressure = $('cr-pressure')?.value ? parseFloat($('cr-pressure').value) : null;
  const isEnergy = meterId === 'SMT-E-0087';
  if (isNaN(value)) { showToast('Please enter a valid value', true); return; }
  const payload = {
    meterId,
    type:   isEnergy ? 'energy' : 'water',
    value,
    userId: AUTH.userId,
    ...(pressure != null && !isEnergy ? { pressure } : {})
  };
  try {
    await apiFetch('usage', '/api/usage/ingest', { method:'POST', body:JSON.stringify(payload) });
    showToast(`✓ Reading ingested for ${meterId}`);
    closeCrudModal();
    loadCrudReadings();
    renderCrudSummaryChart();
  } catch (e) { showToast('Failed to ingest reading: ' + e.message, true); }
}

// EDIT Reading
function openEditReading(r) {
  openModal('✏️ Edit Reading', `
    <form class="crud-form">
      <div class="crud-form-row"><label>Reading ID</label><input type="text" value="${r.id}" disabled style="opacity:.5" /></div>
      <div class="crud-form-row"><label>Meter ID</label><input type="text" value="${r.meter_id}" disabled style="opacity:.5" /></div>
      <div class="crud-form-row"><label>Value</label><input type="number" id="er-value" value="${r.value}" step="0.001" min="0" /></div>
      ${r.pressure != null ? `<div class="crud-form-row"><label>Pressure (bar)</label><input type="number" id="er-pressure" value="${r.pressure}" step="0.1" min="0" /></div>` : ''}
      <div class="crud-form-row">
        <label>Quality</label>
        <select id="er-quality">
          <option value="normal"  ${r.quality==='normal' ?'selected':''}>Normal</option>
          <option value="anomaly" ${r.quality==='anomaly'?'selected':''}>Anomaly</option>
        </select>
      </div>
      <div class="crud-form-actions">
        <button type="button" class="crud-btn-submit" onclick="submitEditReading('${r.id}')">Save Changes</button>
        <button type="button" class="crud-btn-cancel" onclick="closeCrudModal()">Cancel</button>
      </div>
    </form>`);
}

async function submitEditReading(id) {
  const value    = parseFloat($('er-value').value);
  const pressure = $('er-pressure') ? parseFloat($('er-pressure').value) : undefined;
  const quality  = $('er-quality').value;
  try {
    await apiFetch('usage', `/api/usage/readings/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ value, ...(pressure !== undefined ? { pressure } : {}), quality })
    });
    showToast('Reading updated ✓');
    closeCrudModal();
    loadCrudReadings();
  } catch (e) {
    // Update DOM locally if API unavailable
    showToast('Note: Update API not available — showing locally');
    const row = $('row-' + id);
    if (row) {
      const cells = row.querySelectorAll('td');
      cells[3].innerHTML = parseFloat(value).toFixed(3);
      if (pressure !== undefined && cells[4]) cells[4].textContent = pressure + ' bar';
      cells[5].textContent = quality;
      cells[5].className   = quality === 'anomaly' ? 'td-q-anomaly' : 'td-q-normal';
      row.className        = quality === 'anomaly' ? 'row-anomaly' : '';
    }
    closeCrudModal();
  }
}

// DELETE Reading
async function deleteReading(id) {
  if (!confirm('Delete this reading permanently?')) return;
  try {
    await apiFetch('usage', `/api/usage/readings/${id}`, { method:'DELETE' });
    showToast('Reading deleted ✓');
    loadCrudReadings();
  } catch (e) {
    const row = $('row-' + id);
    if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 300); }
    showToast('Removed from view (DELETE API not available)');
  }
}

// ── METERS CRUD ───────────────────────────────────────────────
async function loadCrudMeters() {
  const tbody = $('crud-meters-body'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Loading…</td></tr>';

  const data   = await apiSafe('usage', '/api/usage/meters');
  const meters = data?.meters || [];
  const cntEl  = $('meters-crud-count');
  if (cntEl) cntEl.textContent = meters.length + ' meters';

  if (!meters.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No meters found.</td></tr>';
    return;
  }

  const stDot = s => ({ online:'🟢', warning:'🟡', offline:'🔴' }[s] || '⚪');
  tbody.innerHTML = meters.map(m => `
    <tr id="mrow-${m.id}">
      <td style="color:var(--accent-blue);font-weight:600">${m.id}</td>
      <td>${m.user_name || shortId(m.user_id)}</td>
      <td><span class="type-badge ${m.type}">${m.type}</span></td>
      <td>${m.location || '—'}</td>
      <td>${stDot(m.status)} <span class="${m.status === 'offline' ? 'st-resolved' : m.status === 'warning' ? 'sev-warning' : 'st-active'}">${m.status}</span></td>
      <td class="${m.type==='energy'?'td-energy':'td-value'}">${m.latest_value ? parseFloat(m.latest_value).toFixed(2) + ' ' + (m.unit||'') : '—'}</td>
      <td style="font-size:10px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${fmt(m.last_seen)}</td>
      <td>
        <button class="btn-edit"   onclick='openEditMeter(${JSON.stringify(m)})'>Edit</button>
        <button class="btn-delete" onclick="deleteMeter('${m.id}')">Delete</button>
      </td>
    </tr>`).join('');
}

function openCreateMeter() {
  openModal('➕ Register New Meter', `
    <form class="crud-form">
      <div class="crud-form-row"><label>Meter ID</label><input type="text" id="nm-id" placeholder="SMT-W-XXXX" required /></div>
      <div class="crud-form-row">
        <label>Type</label>
        <select id="nm-type"><option value="water">Water</option><option value="energy">Energy</option></select>
      </div>
      <div class="crud-form-row"><label>Location</label><input type="text" id="nm-location" placeholder="e.g. Main Kitchen Block" /></div>
      <div class="crud-form-row">
        <label>Status</label>
        <select id="nm-status"><option value="online">Online</option><option value="offline">Offline</option><option value="warning">Warning</option></select>
      </div>
      <div class="crud-form-actions">
        <button type="button" class="crud-btn-submit" onclick="submitCreateMeter()">Register Meter</button>
        <button type="button" class="crud-btn-cancel" onclick="closeCrudModal()">Cancel</button>
      </div>
    </form>`);
}

async function submitCreateMeter() {
  const id       = $('nm-id').value.trim().toUpperCase();
  const type     = $('nm-type').value;
  const location = $('nm-location').value.trim();
  const status   = $('nm-status').value;
  if (!id) { showToast('Meter ID is required', true); return; }
  try {
    await apiFetch('usage', '/api/usage/meters', {
      method: 'POST',
      body: JSON.stringify({ id, type, location, status, userId: AUTH.userId })
    });
    showToast('Meter registered: ' + id);
    closeCrudModal();
    loadCrudMeters();
    renderCrudSummaryChart();
  } catch (e) { showToast('Failed: ' + e.message, true); }
}

function openEditMeter(m) {
  openModal('✏️ Edit Meter', `
    <form class="crud-form">
      <div class="crud-form-row"><label>Meter ID</label><input type="text" value="${m.id}" disabled style="opacity:.5" /></div>
      <div class="crud-form-row"><label>Location</label><input type="text" id="em-location" value="${m.location||''}" /></div>
      <div class="crud-form-row">
        <label>Status</label>
        <select id="em-status">
          <option value="online"  ${m.status==='online'  ?'selected':''}>Online</option>
          <option value="offline" ${m.status==='offline' ?'selected':''}>Offline</option>
          <option value="warning" ${m.status==='warning' ?'selected':''}>Warning</option>
        </select>
      </div>
      <div class="crud-form-actions">
        <button type="button" class="crud-btn-submit" onclick="submitEditMeter('${m.id}')">Save Changes</button>
        <button type="button" class="crud-btn-cancel" onclick="closeCrudModal()">Cancel</button>
      </div>
    </form>`);
}

async function submitEditMeter(id) {
  const location = $('em-location').value.trim();
  const status   = $('em-status').value;
  try {
    await apiFetch('usage', `/api/usage/meters/${id}`, {
      method: 'PUT', body: JSON.stringify({ location, status })
    });
    showToast('Meter updated ✓');
    closeCrudModal();
    loadCrudMeters();
  } catch (e) {
    const row = $('mrow-' + id);
    if (row) {
      row.querySelectorAll('td')[3].textContent = location || '—';
      const stDot = { online:'🟢', warning:'🟡', offline:'🔴' }[status] || '⚪';
      row.querySelectorAll('td')[4].innerHTML = stDot + ' ' + status;
    }
    showToast('Status updated locally');
    closeCrudModal();
  }
}

async function deleteMeter(id) {
  if (!confirm(`Delete meter ${id}? This will also delete all its readings.`)) return;
  try {
    await apiFetch('usage', `/api/usage/meters/${id}`, { method:'DELETE' });
    showToast('Meter deleted: ' + id);
    loadCrudMeters();
    renderCrudSummaryChart();
  } catch (e) {
    const row = $('mrow-' + id);
    if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 300); }
    showToast('Removed from view (DELETE API not available)');
  }
}

// ── ALERTS CRUD ───────────────────────────────────────────────
async function loadCrudAlerts() {
  const tbody = $('crud-alerts-body'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Loading…</td></tr>';

  const data   = AUTH.demo
    ? { alerts: MOCK.alerts }
    : await apiSafe('alert', `/api/alerts/user/${AUTH.userId}`);
  const alerts = data?.alerts || [];

  const cntEl = $('alerts-crud-count');
  if (cntEl) cntEl.textContent = alerts.length + ' alerts';

  if (!alerts.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No alerts. System is clean ✓</td></tr>';
    return;
  }

  tbody.innerHTML = alerts.map(a => `
    <tr id="arow-${a.id}">
      <td style="font-weight:600;color:var(--text-primary);max-width:200px;white-space:normal;line-height:1.4">${a.title}</td>
      <td>${a.type || '—'}</td>
      <td class="sev-${a.severity}">${a.severity.toUpperCase()}</td>
      <td style="color:var(--accent-blue);font-family:'JetBrains Mono',monospace;font-size:11px">${a.meter_id || '—'}</td>
      <td class="${a.status==='active'?'st-active':'st-resolved'}">${a.status}</td>
      <td>${timeAgo(a.created_at)}</td>
      <td>
        ${a.status === 'active' ? `<button class="btn-resolve" onclick="resolveAlert('${a.id}')">Resolve</button>` : ''}
        <button class="btn-delete" onclick="deleteAlert('${a.id}')">Delete</button>
      </td>
    </tr>`).join('');
}

function openCreateAlert() {
  openModal('🔔 Create Alert', `
    <form class="crud-form">
      <div class="crud-form-row"><label>Title</label><input type="text" id="na-title" placeholder="e.g. High Pressure Detected" required /></div>
      <div class="crud-form-row"><label>Description</label><textarea id="na-desc" placeholder="Describe the alert…"></textarea></div>
      <div class="crud-form-row">
        <label>Severity</label>
        <select id="na-severity">
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div class="crud-form-row">
        <label>Meter ID (optional)</label>
        <select id="na-meter">
          <option value="">— None —</option>
          <option value="SMT-W-0041">SMT-W-0041</option>
          <option value="SMT-W-0042">SMT-W-0042</option>
          <option value="SMT-E-0087">SMT-E-0087</option>
        </select>
      </div>
      <div class="crud-form-actions">
        <button type="button" class="crud-btn-submit" onclick="submitCreateAlert()">Create Alert</button>
        <button type="button" class="crud-btn-cancel" onclick="closeCrudModal()">Cancel</button>
      </div>
    </form>`);
}

async function submitCreateAlert() {
  const title    = $('na-title').value.trim();
  const desc     = $('na-desc').value.trim();
  const severity = $('na-severity').value;
  const meterId  = $('na-meter').value || null;
  if (!title) { showToast('Title is required', true); return; }
  try {
    await apiFetch('alert', '/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ title, description:desc, severity, type:severity, meter_id:meterId, user_id:AUTH.userId })
    });
    showToast('Alert created ✓');
    closeCrudModal();
    _fullAlerts = null;
    loadCrudAlerts();
  } catch (e) { showToast('Failed: ' + e.message, true); }
}

async function resolveAlert(id) {
  try {
    await apiFetch('alert', `/api/alerts/${id}/resolve`, { method:'PUT' });
    showToast('Alert resolved ✓');
    _fullAlerts = null;
    loadCrudAlerts();
  } catch (e) {
    const row = $('arow-' + id);
    if (row) {
      const cells = row.querySelectorAll('td');
      cells[4].className   = 'st-resolved';
      cells[4].textContent = 'resolved';
      cells[6].querySelector('.btn-resolve')?.remove();
    }
    showToast('Marked as resolved locally');
  }
}

async function deleteAlert(id) {
  if (!confirm('Delete this alert permanently?')) return;
  try {
    await apiFetch('alert', `/api/alerts/${id}`, { method:'DELETE' });
    showToast('Alert deleted ✓');
    _fullAlerts = null;
    loadCrudAlerts();
  } catch (e) {
    const row = $('arow-' + id);
    if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 300); }
    showToast('Removed from view');
  }
}

// ── Modal Helpers ─────────────────────────────────────────────
function openModal(title, bodyHtml) {
  $('crud-modal-title').textContent = title;
  $('crud-modal-body').innerHTML    = bodyHtml;
  $('crud-modal').style.display     = 'flex';
}
function closeCrudModal() { $('crud-modal').style.display = 'none'; }

// ── Type Badge helper ─────────────────────────────────────────
// .type-badge is defined in portal.css
