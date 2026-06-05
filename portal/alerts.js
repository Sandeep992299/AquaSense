/* =============================================
   AquaSense – Alerts Page JS
   Depends on: shared.js, sidebar.js
   ============================================= */

// ── State Variables ──────────────────────────────────────────
let _fullAlerts = null;
let currentFilter = 'all';

// ── Page Init ──────────────────────────────────────────────────
function initAlerts() {
  renderSidebar('alerts');
  filterAlerts('all', $('btn-filter-all'));
}

// ── Alert Handling Logic ──────────────────────────────────────
async function loadFullAlerts() {
  if (_fullAlerts) return _fullAlerts;
  if (AUTH.demo) { _fullAlerts = MOCK.alerts; return _fullAlerts; }
  const data = await apiSafe('alert', `/api/alerts/user/${AUTH.userId}`);
  _fullAlerts = data?.alerts || MOCK.alerts;
  return _fullAlerts;
}

async function renderFullAlerts(filter) {
  const el = $('alerts-full'); if (!el) return;
  el.innerHTML = '<div style="color:#4a5568;padding:20px">Loading alerts…</div>';
  const allAlerts = await loadFullAlerts();
  el.innerHTML = '';
  const filtered = filter==='all' ? allAlerts : allAlerts.filter(a => a.severity===filter);
  if (!filtered.length) { el.innerHTML = '<div style="color:#4a5568;padding:20px">No alerts found.</div>'; return; }
  
  filtered.forEach(a => {
    el.innerHTML += `
      <div class="alert-full-item ${a.severity}">
        <span style="font-size:22px">${ALERT_ICON[a.severity] || '📌'}</span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;margin-bottom:4px">${a.title}</div>
          <div class="alert-desc">${a.description || ''}</div>
          <div class="alert-full-meta">${timeAgo(a.created_at)} · via AWS SNS</div>
        </div>
        <span class="alert-badge">${a.severity}</span>
      </div>`;
  });
}

function filterAlerts(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderFullAlerts(f);
}

// ── Bootstrap ──────────────────────────────────────────────────
bootstrapPage('alerts', initAlerts);
