/* =============================================
   AquaSense Customer Web Portal – JavaScript
   Enhanced with Live Telemetry + Full CRUD
   ============================================= */

// ===== CONFIGURATION =====
const CONFIG = window.AQUA_CONFIG || {};
const ALB    = CONFIG.baseUrl || 'http://tf-aqua-sense-production-alb-840180883.ap-south-1.elb.amazonaws.com';
const SERVICES = {
  user:    ALB,
  billing: ALB,
  usage:   ALB,
  alert:   ALB,
  cognito: CONFIG.cognito || { region: 'ap-south-1', userPoolId: '', clientId: '' }
};

// Known meters for the current user (updated after login)
const MY_METERS = ['SMT-W-0041', 'SMT-W-0042', 'SMT-E-0087'];

// ===== UTILS =====
const $ = id => document.getElementById(id);
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));
function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
       + ' ' + d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
}
function shortId(id) { return id ? id.substring(0, 8) + '…' : '—'; }

// ===== COGNITO SETUP =====
let userPool = null;
try {
  if (typeof AmazonCognitoIdentity !== 'undefined') {
    const poolData = { UserPoolId: SERVICES.cognito.userPoolId, ClientId: SERVICES.cognito.clientId };
    userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
  }
} catch (e) { console.error('Failed to initialize Cognito:', e); }

// ===== AUTH STATE =====
let AUTH = {
  token:  localStorage.getItem('aqua_token'),
  userId: localStorage.getItem('aqua_userId'),
  user:   null,
  demo:   false,
};

// ===== DATE/TIME =====
function updateDate() {
  const el = $('live-date');
  if (el) el.textContent = new Date().toLocaleString('en-IN',
    { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(updateDate, 1000);
updateDate();

// ===== API HELPERS =====
async function apiFetch(svc, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (AUTH.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const res = await fetch(SERVICES[svc] + path, { ...opts, headers });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

async function apiSafe(svc, path, fallback = null, fetchOpts = {}) {
  try { return await apiFetch(svc, path, fetchOpts); }
  catch (err) {
    console.warn(`[portal] ${svc}${path} → ${err.message}`);
    if (!AUTH.token && !AUTH.demo) showDemoNotice();
    if (AUTH.demo) showDemoNotice();
    return fallback;
  }
}

// ===== TOAST =====
function showToast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'crud-toast' + (isError ? ' error' : '');
  el.innerHTML = (isError ? '✕ ' : '✓ ') + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ===== DEMO MODE =====
let _demoNoticeShown = false;
function showDemoNotice() {
  if (_demoNoticeShown) return;
  _demoNoticeShown = true;
  const el = $('demo-notice');
  if (el) {
    el.innerHTML = AUTH.demo
      ? '🎭 Demo Mode — simulated data only. <a href="#" onclick="showLoginModal();return false;">Sign in for live data</a>'
      : '⚠️ Backend services offline — showing cached/simulated data.';
    el.style.display = 'flex';
  }
}

// ===== LOGIN UI HELPERS =====
function hideLoginModal() { $('login-overlay')?.classList.add('hidden'); }
function showLoginModal()  { $('login-overlay')?.classList.remove('hidden'); }

function updateUserCard(user) {
  const name    = user?.name  || 'Guest';
  const role    = user?.role  || 'residential';
  const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const nameEl   = document.querySelector('.user-name');
  const roleEl   = document.querySelector('.user-role');
  const avatarEl = $('user-avatar-initials');
  const signoutBtn = $('btn-signout');
  if (nameEl)   nameEl.textContent   = name;
  if (roleEl)   roleEl.textContent   = role.charAt(0).toUpperCase() + role.slice(1);
  if (avatarEl) avatarEl.textContent = initials;
  if (signoutBtn) signoutBtn.style.display = AUTH.demo ? 'none' : 'flex';
}

let _pendingCognitoUser = null;

async function handleLogin(email, password) {
  const btn = $('btn-login');
  const err = $('login-error');
  btn.textContent = 'Signing in…'; btn.disabled = true; err.textContent = '';

  if (!userPool) {
    err.textContent = 'Cognito not configured. Check config.js and try Demo Mode.';
    btn.textContent = 'Sign In'; btn.disabled = false; return;
  }

  const authDetails  = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
  const cognitoUser  = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool });

  cognitoUser.authenticateUser(authDetails, {
    onSuccess: async (result) => {
      AUTH.token = result.getIdToken().getJwtToken();
      AUTH.demo  = false;
      localStorage.setItem('aqua_token', AUTH.token);
      cognitoUser.getUserAttributes((attrErr, attributes) => {
        if (!attrErr && attributes) {
          const u = {};
          attributes.forEach(a => u[a.getName()] = a.getValue());
          AUTH.user   = { name: u.name || email, role: u['custom:account_type'] || 'residential', id: u.sub };
          AUTH.userId = u.sub;
          localStorage.setItem('aqua_userId', AUTH.userId);
        } else {
          AUTH.user = { name: email, role: 'residential' };
        }
        btn.textContent = 'Sign In'; btn.disabled = false;
        hideLoginModal();
        updateUserCard(AUTH.user);
        initDashboard();
        showSection('dashboard');
        loadDashboardData();
      });
    },
    onFailure: (e) => {
      err.textContent = e.message || 'Sign-in failed.';
      btn.textContent = 'Sign In'; btn.disabled = false;
    },
    newPasswordRequired: () => {
      _pendingCognitoUser = cognitoUser;
      btn.textContent = 'Sign In'; btn.disabled = false;
      $('login-form').style.display = 'none';
      $('new-pw-panel').style.display = 'block';
      if ($('login-title')) $('login-title').textContent = 'Set New Password';
    }
  });
}

function handleSignOut() {
  const cu = userPool?.getCurrentUser();
  if (cu) cu.signOut();
  AUTH = { token: null, userId: null, user: null, demo: false };
  localStorage.removeItem('aqua_token');
  localStorage.removeItem('aqua_userId');
  showLoginModal();
}

function handleSetNewPassword() {
  const pw = $('new-pw-input').value;
  const pw2 = $('new-pw-confirm').value;
  const err = $('login-error');
  if (pw !== pw2) { err.textContent = 'Passwords do not match.'; return; }
  if (!_pendingCognitoUser) { err.textContent = 'Session expired.'; return; }
  _pendingCognitoUser.completeNewPasswordChallenge(pw, {}, {
    onSuccess: (result) => {
      AUTH.token = result.getIdToken().getJwtToken();
      AUTH.demo  = false;
      localStorage.setItem('aqua_token', AUTH.token);
      _pendingCognitoUser.getUserAttributes((attrErr, attributes) => {
        if (!attrErr && attributes) {
          const u = {}; attributes.forEach(a => u[a.getName()] = a.getValue());
          AUTH.user = { name: u.name || 'User', role: u['custom:account_type'] || 'residential', id: u.sub };
          AUTH.userId = u.sub; localStorage.setItem('aqua_userId', AUTH.userId);
        } else { AUTH.user = { name: 'User', role: 'residential' }; }
        _pendingCognitoUser = null;
        $('new-pw-panel').style.display = 'none';
        hideLoginModal(); updateUserCard(AUTH.user);
        initDashboard(); showSection('dashboard'); loadDashboardData();
      });
    },
    onFailure: (e) => { $('login-error').textContent = e.message || 'Failed to set password.'; }
  });
}

function enterDemoMode() {
  AUTH = { token: null, userId: 'a0000001-0000-0000-0000-000000000001', user: { name: 'Demo User', role: 'residential' }, demo: true };
  localStorage.removeItem('aqua_token'); localStorage.removeItem('aqua_userId');
  hideLoginModal(); showDemoNotice(); updateUserCard(AUTH.user); initDashboard();
}

async function checkExistingAuth() {
  if (!userPool) return false;
  const cu = userPool.getCurrentUser();
  if (!cu) return false;
  return new Promise((resolve) => {
    cu.getSession((err, session) => {
      if (err || !session.isValid()) { resolve(false); return; }
      AUTH.token = session.getIdToken().getJwtToken();
      localStorage.setItem('aqua_token', AUTH.token);
      cu.getUserAttributes((attrErr, attributes) => {
        if (attrErr) { resolve(false); return; }
        const u = {}; attributes.forEach(a => u[a.getName()] = a.getValue());
        AUTH.user   = { name: u.name, role: u['custom:account_type'] || 'residential', id: u.sub };
        AUTH.userId = u.sub;
        localStorage.setItem('aqua_userId', AUTH.userId);
        updateUserCard(AUTH.user);
        resolve(true);
      });
    });
  });
}

// ===== FORGOT PASSWORD =====
function toggleForgotPw(show) {
  $('login-form').style.display = show ? 'none' : 'block';
  $('forgot-pw-panel').style.display = show ? 'block' : 'none';
  $('login-title').textContent = show ? 'Reset Password' : 'Welcome back';
}
function handleForgotPwSend() {
  const email = $('forgot-email').value.trim();
  if (!email) return alert('Enter email');
  const cu = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool });
  cu.forgotPassword({
    onSuccess: () => {},
    onFailure: (e) => alert(e.message),
    inputVerificationCode: () => {
      $('forgot-confirm-panel').style.display = 'block';
      $('btn-send-code').textContent = 'Code Sent';
    }
  });
}
function handleForgotPwConfirm() {
  const email = $('forgot-email').value.trim();
  const code  = $('forgot-code').value.trim();
  const newPw = $('forgot-new-pw').value;
  const cu = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool });
  cu.confirmPassword(code, newPw, {
    onSuccess: () => { alert('Password reset! You can now sign in.'); toggleForgotPw(false); },
    onFailure: (e) => alert(e.message)
  });
}

// ===== SIGN UP / VERIFY =====
function toggleSignUp(show) {
  $('login-form').style.display = show ? 'none' : 'block';
  $('signup-panel').style.display = show ? 'block' : 'none';
  $('btn-demo').style.display = show ? 'none' : 'block';
  if ($('login-divider'))      $('login-divider').style.display = show ? 'none' : 'block';
  if ($('login-footer-signin')) $('login-footer-signin').style.display = show ? 'none' : 'block';
  if ($('login-title')) $('login-title').textContent = show ? 'Create Account' : 'Welcome back';
}
async function handleSignUp(e) {
  e.preventDefault();
  const name = $('signup-name').value;
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const meter = $('signup-meter').value;
  const btn = $('btn-signup-submit'); btn.textContent = 'Creating…'; btn.disabled = true;
  const attrs = [
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'name', Value: name }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'custom:meter_id', Value: meter || 'pending' }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'custom:account_type', Value: 'residential' })
  ];
  userPool.signUp(email, password, attrs, null, (err) => {
    btn.disabled = false; btn.textContent = 'Create Account';
    if (err) { $('login-error').textContent = err.message; return; }
    $('signup-panel').style.display = 'none';
    $('verify-panel').style.display = 'block';
    $('login-title').textContent = 'Verify Email';
  });
}
async function handleVerifyCode() {
  const email = $('signup-email').value.trim() || $('login-email').value.trim();
  const code  = $('verify-code').value.trim();
  const cu = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool });
  cu.confirmRegistration(code, true, (err) => {
    if (err) { $('login-error').textContent = err.message; return; }
    alert('✅ Account verified! You can now sign in.');
    toggleSignUp(false); $('verify-panel').style.display = 'none';
  });
}

// ===== NAV =====
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('section-' + name)?.classList.add('active');
  $('nav-' + name)?.classList.add('active');
  $('page-title').textContent = {
    dashboard:'Dashboard', live:'Live Telemetry', crud:'Data Management',
    water:'Water Usage', energy:'Energy Monitor', alerts:'Alerts', reports:'Reports', meters:'My Meters'
  }[name] || name;
  history.pushState({ section: name }, '', '#' + name);
  // Initialize section-specific content
  if (name === 'live')      initLiveSection();
  if (name === 'crud')      initCrudSection();
  if (name === 'water')     renderDetailCharts();
  if (name === 'energy')    renderEnergyCharts();
  if (name === 'alerts')    loadFullAlerts();
  if (name === 'reports')   renderReports();
  if (name === 'meters')    loadAndRenderMeters();
}
function toggleSidebar() { $('sidebar')?.classList.toggle('open'); }

// ===== SPARKLINE =====
function makeSparkline(id, data, color) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: { labels: data.map((_,i) => i), datasets: [{ data, borderColor: color, borderWidth: 1.5, pointRadius: 0, fill: true,
      backgroundColor: ctx => { const gr = ctx.chart.ctx.createLinearGradient(0,0,0,36);
        gr.addColorStop(0, color + '55'); gr.addColorStop(1, color + '00'); return gr; } }] },
    options: { animation:false, plugins:{ legend:{display:false}, tooltip:{enabled:false} },
      scales:{ x:{display:false}, y:{display:false} }, responsive:true, maintainAspectRatio:false }
  });
}

// ===== DATA GENERATORS =====
function generateHourly(base, noise, points=24) {
  return Array.from({length:points}, (_,i) => Math.max(0, base + Math.sin(i/4)*base*0.3 + rand(-noise,noise)));
}
function generateDays(base, noise, points=7) {
  return Array.from({length:points}, () => Math.max(0, base + rand(-noise, noise)));
}

// ===== CHART HELPERS =====
const charts = {};
function makeLineChart(id, labels, datasets, opts={}) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: {
      animation: { duration: 600 },
      plugins: { legend: { labels: { color:'#94a3b8', font:{size:11}, boxWidth:12 } } },
      scales: {
        x: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.05)'} },
        y: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.05)'} }
      },
      responsive:true, maintainAspectRatio:true, ...opts
    }
  });
  return charts[id];
}
function makeDoughnut(id, labels, data, colors) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets:[{ data, backgroundColor:colors, borderColor:'#0d1626', borderWidth:2, hoverOffset:6 }] },
    options: { cutout:'62%', plugins:{ legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:11},boxWidth:10,padding:10}} }, responsive:true, maintainAspectRatio:false }
  });
}

// ===== MOCK DATA =====
const MOCK = {
  waterToday:284, energyToday:18.4, pressure:2.4, bill:1842,
  alerts:[
    { severity:'critical', title:'Leakage Detected – Zone C', description:'Flow sensor abnormal delta.', created_at:new Date(Date.now()-7200000).toISOString(), status:'active' },
    { severity:'warning',  title:'High Water Consumption',   description:'Daily usage exceeded 120% of baseline.', created_at:new Date(Date.now()-86400000).toISOString(), status:'active' },
    { severity:'info',     title:'Monthly Bill Generated',   description:'Your bill has been generated.', created_at:new Date(Date.now()-259200000).toISOString(), status:'active' },
  ],
};
const ALERT_ICON = { critical:'🚨', warning:'⚠️', info:'📋' };

// ===== DASHBOARD DATA =====
async function loadDashboardData() {
  if (AUTH.demo) return;
  const summary = await apiSafe('usage', `/api/usage/summary/${AUTH.userId}`);
  if (summary?.summary) {
    const s = summary.summary;
    animCount('kpi-water',    0, parseFloat(s.today_water_l)   || MOCK.waterToday,  'L',   1200);
    animCount('kpi-energy',   0, parseFloat(s.today_energy_kwh) || MOCK.energyToday, 'kWh', 1200, 1);
    animCount('kpi-pressure', 2.0, MOCK.pressure, 'bar', 800, 1);
  } else {
    animCount('kpi-water',    0, MOCK.waterToday,  'L',   1200);
    animCount('kpi-energy',   0, MOCK.energyToday, 'kWh', 1200, 1);
    animCount('kpi-pressure', 2.0, MOCK.pressure,  'bar', 800,  1);
  }
  const billsData = await apiSafe('billing', `/api/bills/user/${AUTH.userId}`);
  const el = $('kpi-bill');
  if (billsData?.bills?.length && el) {
    el.innerHTML = `₹ ${parseFloat(billsData.bills[0].total).toLocaleString('en-IN')}`;
  } else if (el) {
    el.innerHTML = `₹ ${MOCK.bill.toLocaleString('en-IN')}`;
  }
  const alertsData = await apiSafe('alert', `/api/alerts/user/${AUTH.userId}`);
  const badge = $('alert-badge');
  if (badge) badge.textContent = alertsData?.active ?? 0;
  renderDashboardAlerts(alertsData?.alerts || null);
}

// ===== INIT DASHBOARD =====
let _dashboardInited = false;
function initDashboard() {
  if (_dashboardInited) return;
  _dashboardInited = true;
  makeSparkline('spark-water',    generateDays(280,40), '#38bdf8');
  makeSparkline('spark-energy',   generateDays(18, 4),  '#fbbf24');
  makeSparkline('spark-pressure', generateDays(2.3,0.3),'#a78bfa');
  makeSparkline('spark-bill',     generateDays(1800,200),'#34d399');
  renderWaterChart(7); renderBreakdownChart(); startLiveFeed();
  animCount('kpi-pressure', 2.0, MOCK.pressure, 'bar', 800, 1);
  $('kpi-bill').innerHTML = `₹ ${MOCK.bill.toLocaleString('en-IN')}`;
  if (!AUTH.demo) {
    loadDashboardData();
    setInterval(loadDashboardData, 5000);
  } else {
    animCount('kpi-water',  0, MOCK.waterToday,  'L',   1200);
    animCount('kpi-energy', 0, MOCK.energyToday, 'kWh', 1200, 1);
    renderDashboardAlerts(null);
  }
}

function renderWaterChart(days) {
  const labels = [];
  const d = new Date();
  for (let i=days-1; i>=0; i--) {
    const t = new Date(d); t.setDate(d.getDate()-i);
    labels.push(t.toLocaleDateString('en-IN', {weekday:'short', day:'numeric'}));
  }
  makeLineChart('chart-water-usage', labels, [
    { label:'Consumption (L)', data:generateDays(260,60,days), borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:3, pointBackgroundColor:'#38bdf8' },
    { label:'Target (L)',      data:Array(days).fill(300), borderColor:'rgba(52,211,153,0.5)', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false }
  ]);
}
function setWaterRange(days, btn) {
  document.querySelectorAll('.chart-controls .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderWaterChart(days);
}
function renderBreakdownChart() {
  makeDoughnut('chart-breakdown', ['Kitchen','Bathroom','Garden','Laundry'], [31, 44, 15, 10],
    ['#38bdf8','#06b6d4','#34d399','#a78bfa']);
}

// ===== KPI ANIMATION =====
function animCount(id, from, to, unit, dur, decimals=0) {
  const el = $(id); if (!el) return;
  const step = (to - from) / 60;
  let cur = from;
  const iv = setInterval(() => {
    cur += step;
    if ((step>0&&cur>=to)||(step<0&&cur<=to)) { cur=to; clearInterval(iv); }
    el.innerHTML = cur.toFixed(decimals) + ' <small>' + unit + '</small>';
  }, dur/60);
}

// ===== LIVE FEED (dashboard) =====
const feedEvents = [
  { msg:'Flow sensor SMT-W-0041 reading normal',        color:'#34d399' },
  { msg:'Pressure @ Kitchen Block: 2.4 bar – OK',       color:'#38bdf8' },
  { msg:'Smart meter SMT-W-0042 data synced to RDS',    color:'#a78bfa' },
  { msg:'IoT Core rule triggered → usage-service',       color:'#38bdf8' },
  { msg:'Lambda anomaly-detector invoked (OK)',           color:'#fbbf24' },
  { msg:'Aurora DB heartbeat confirmed',                 color:'#34d399' },
  { msg:'SNS alert dispatched to endpoint',              color:'#fb923c' },
  { msg:'ECS task aqua-usage-svc healthy',               color:'#34d399' },
  { msg:'SMT-E-0087 energy reading ingested',            color:'#fbbf24' },
  { msg:'CloudWatch alarm OK state',                     color:'#34d399' },
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
function startLiveFeed() { addFeedItem(); setInterval(addFeedItem, 2800); }

// ===== ALERTS =====
function alertIcon(severity) { return ALERT_ICON[severity] || '📌'; }
function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff/60000), h = Math.floor(m/60), d = Math.floor(h/24);
  return d>0 ? `${d}d ago` : h>0 ? `${h}h ago` : m>0 ? `${m}m ago` : 'just now';
}
function renderDashboardAlerts(alerts) {
  const el = $('dashboard-alerts'); if (!el) return;
  el.innerHTML = '';
  (alerts || MOCK.alerts).slice(0, 3).forEach(a => {
    el.innerHTML += `<div class="alert-item ${a.severity}">
      <span class="alert-icon">${alertIcon(a.severity)}</span>
      <div class="alert-body">
        <div class="alert-title">${a.title}</div>
        <div class="alert-time">${timeAgo(a.created_at)}</div>
      </div></div>`;
  });
}
let currentFilter = 'all', _fullAlerts = null;
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
    el.innerHTML += `<div class="alert-full-item ${a.severity}">
      <span style="font-size:22px">${alertIcon(a.severity)}</span>
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

// ===== SECTION CHART INIT =====
function initSectionCharts(name) {
  if (name === 'water')   initWaterSection();
  if (name === 'energy')  initEnergySection();
  if (name === 'alerts')  renderFullAlerts(currentFilter);
  if (name === 'reports') renderReports();
  if (name === 'meters')  loadAndRenderMeters();
  if (name === 'live')    initLiveSection();
  if (name === 'crud')    initCrudSection();
}

function initWaterSection() {
  const months30 = Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-29+i);return d.getDate()+'/'+d.toLocaleString('en-IN',{month:'short'});});
  makeLineChart('chart-water-detail', months30, [
    { label:'Litres', data:generateDays(265,60,30), borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.12)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 }
  ]);
  const hours = Array.from({length:24},(_,i)=>i+':00');
  makeLineChart('chart-pressure', hours, [
    { label:'Pressure (bar)', data:generateHourly(2.3,0.3), borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 }
  ]);
}
function initEnergySection() {
  const hours = Array.from({length:24},(_,i)=>i+':00');
  makeLineChart('chart-energy-hourly', hours, [
    { label:'kWh', data:generateHourly(0.7,0.3), borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 }
  ]);
  makeDoughnut('chart-energy-mix', ['Grid','Solar','Off-Peak','Battery'], [55,22,15,8],
    ['#fbbf24','#34d399','#38bdf8','#fb923c']);
}

// ===== REPORTS =====
const reports = [
  { icon:'💧', title:'June 2026 – Water Report',    meta:'Generated Jun 1 · PDF · 1.2MB',  dl:'Download PDF' },
  { icon:'⚡', title:'June 2026 – Energy Report',   meta:'Generated Jun 1 · PDF · 980KB',  dl:'Download PDF' },
  { icon:'📊', title:'Q2 2026 Usage Analytics',      meta:'Generated Jun 1 · PDF · 3.1MB', dl:'Download PDF' },
  { icon:'💰', title:'May 2026 Bill Statement',      meta:'Generated May 31 · PDF · 450KB', dl:'Download PDF' },
  { icon:'🔍', title:'Anomaly Detection Log',        meta:'Generated Jun 1 · CSV · 220KB',  dl:'Download CSV' },
  { icon:'📈', title:'Demand Forecast – Jul 2026',   meta:'Generated Jun 1 · XLSX · 1.8MB', dl:'Download XLSX'},
];
function renderReports() {
  const el = $('reports-grid'); if (!el || el.innerHTML) return;
  reports.forEach(r => {
    el.innerHTML += `<div class="report-card">
      <div class="report-icon">${r.icon}</div>
      <div class="report-title">${r.title}</div>
      <div class="report-meta">${r.meta}</div>
      <div class="report-dl">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        ${r.dl}
      </div></div>`;
  });
}

// ===== METERS (My Meters section) =====
async function loadAndRenderMeters() {
  const el = $('meters-grid'); if (!el || el.innerHTML) return;
  el.innerHTML = '<div style="color:#4a5568;padding:20px">Loading meters…</div>';
  const data   = AUTH.demo ? null : await apiSafe('usage', '/api/usage/meters');
  const meters = data?.meters || [];
  el.innerHTML = '';
  if (!meters.length) { el.innerHTML = '<div style="color:#4a5568;padding:20px">No meters found.</div>'; return; }
  meters.forEach(m => {
    const statusIcon = { online:'🟢', warning:'🟡', offline:'🔴' }[m.status] || '⚪';
    const isWater    = m.type === 'water';
    const val        = m.latest_value ?? 0;
    const pct = m.status === 'offline' ? 0 : isWater ? Math.min(100,(val/350)*100) : Math.min(100,(val/25)*100);
    let readings = '';
    if (isWater)          readings += `<div class="reading-row"><span class="reading-label">Flow Rate</span><span class="reading-val" style="color:#38bdf8">${parseFloat(val).toFixed(2)} ${m.unit||'L'}</span></div>`;
    if (m.pressure!=null) readings += `<div class="reading-row"><span class="reading-label">Pressure</span><span class="reading-val" style="color:#a78bfa">${m.pressure} bar</span></div>`;
    if (!isWater)         readings += `<div class="reading-row"><span class="reading-label">Energy</span><span class="reading-val" style="color:#fbbf24">${parseFloat(val).toFixed(2)} ${m.unit||'kWh'}</span></div>`;
    el.innerHTML += `<div class="meter-card">
      <div class="meter-header">
        <span class="meter-id">${m.id}</span>
        <span class="meter-status ${m.status}"><span class="status-dot"></span>${m.status.toUpperCase()}</span>
      </div>
      <div class="meter-name">${statusIcon} ${m.user_name ? m.user_name + ' – ' : ''}${isWater?'Water Meter':'Energy Meter'}</div>
      <div class="meter-location">📍 ${m.location || '—'}</div>
      <div class="meter-bar"><div class="meter-bar-fill" style="width:${pct}%"></div></div>
      <div class="meter-readings">${readings}</div>
      ${m.last_seen ? `<div style="font-size:10px;color:var(--text-muted);margin-top:8px;font-family:'JetBrains Mono',monospace">Last seen: ${fmt(m.last_seen)}</div>` : ''}
    </div>`;
  });
}

// =====================================================================
// LIVE TELEMETRY SECTION
// =====================================================================
let _liveInited    = false;
let _liveMeters    = [];
let _liveFilter    = 'all';
let _liveChartData = {};  // meterId → array of {t, v}
let _liveChartMeter = 'SMT-W-0041';

async function initLiveSection() {
  if (_liveInited) return;
  _liveInited = true;
  await refreshLiveMeters();
  await refreshLiveReadings();
  initLiveChart(_liveChartMeter);
  // Auto-refresh every 5s
  setInterval(async () => {
    await refreshLiveMeters();
    await refreshLiveReadings();
    updateLiveChart(_liveChartMeter);
  }, 5000);
}

async function refreshLiveMeters() {
  const data = await apiSafe('usage', '/api/usage/meters');
  _liveMeters = data?.meters || [];
  renderLiveMeterCards(_liveMeters);
}

function renderLiveMeterCards(meters) {
  const el = $('live-meter-cards'); if (!el) return;
  // Filter to only the logged-in user's meters
  const mine = AUTH.demo ? meters : meters.filter(m =>
    m.user_id === AUTH.userId || MY_METERS.includes(m.id)
  );
  el.innerHTML = '';
  mine.forEach(m => {
    const val = m.latest_value != null ? parseFloat(m.latest_value).toFixed(2) : '—';
    const unit = m.unit || (m.type === 'water' ? 'L' : 'kWh');
    el.innerHTML += `
      <div class="live-meter-card ${m.type}" id="lmc-${m.id}">
        <div class="lmc-header">
          <span class="lmc-id">${m.id}</span>
          <span class="lmc-status ${m.status}">
            <span class="lmc-status-dot"></span>${m.status.toUpperCase()}
          </span>
        </div>
        <div class="lmc-value ${m.type}">${val}</div>
        <div class="lmc-unit">${unit} — ${m.type === 'water' ? 'Flow Reading' : 'Power Draw'}</div>
        <div class="lmc-location">📍 ${m.location || '—'}</div>
        ${m.pressure != null ? `<div class="lmc-pressure">⦿ Pressure: ${m.pressure} bar</div>` : ''}
        ${m.last_seen ? `<div class="lmc-last-seen">Last seen: ${fmt(m.last_seen)}</div>` : '<div class="lmc-last-seen">No data yet</div>'}
      </div>`;
  });
  if (!mine.length) {
    el.innerHTML = '<div style="color:var(--text-muted);padding:20px">No meters assigned to your account.</div>';
  }
}

// --- Live Readings Table ---
let _liveReadingsCache = [];
async function refreshLiveReadings() {
  // Fetch latest 15 readings for each of the user's meters
  const promises = MY_METERS.map(mid =>
    apiSafe('usage', `/api/usage/readings/${mid}?limit=15`)
  );
  const results = await Promise.all(promises);
  _liveReadingsCache = [];
  results.forEach(r => { if (r?.data) _liveReadingsCache.push(...r.data); });
  // Sort by recorded_at descending
  _liveReadingsCache.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
  // Update live chart data
  MY_METERS.forEach((mid, i) => {
    const rows = results[i]?.data || [];
    _liveChartData[mid] = rows.slice().reverse().map(r => ({
      t: new Date(r.recorded_at).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      v: parseFloat(r.value)
    }));
  });
  renderLiveReadingsTable();
}

function filterLiveReadings(type, btn) {
  _liveFilter = type;
  document.querySelectorAll('[id^="live-filter-"]').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderLiveReadingsTable();
}

function renderLiveReadingsTable() {
  const tbody = $('live-readings-body'); if (!tbody) return;
  const rows  = _liveFilter === 'all' ? _liveReadingsCache
              : _liveReadingsCache.filter(r => r.type === _liveFilter);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No readings yet — start the simulator to stream data</td></tr>';
    return;
  }
  tbody.innerHTML = rows.slice(0, 40).map(r => `
    <tr>
      <td title="${r.id}">${shortId(r.id)}</td>
      <td style="color:var(--accent-blue)">${r.meter_id}</td>
      <td>${r.type}</td>
      <td class="${r.type === 'energy' ? 'td-energy' : 'td-value'}">${parseFloat(r.value).toFixed(3)} ${r.unit || ''}</td>
      <td class="td-pressure">${r.pressure != null ? r.pressure + ' bar' : '—'}</td>
      <td class="${r.quality === 'anomaly' ? 'td-q-anomaly' : 'td-q-normal'}">${r.quality}</td>
      <td>${fmt(r.recorded_at)}</td>
    </tr>`).join('');
}

// --- Live Real-Time Chart ---
function initLiveChart(meterId) {
  const data = _liveChartData[meterId] || [];
  const labels = data.map(d => d.t);
  const vals   = data.map(d => d.v);
  const color  = meterId === 'SMT-E-0087' ? '#fbbf24' : '#38bdf8';
  makeLineChart('chart-live-flow', labels, [{
    label: meterId + ' – Value',
    data: vals,
    borderColor: color,
    backgroundColor: color.replace(')', ',.1)').replace('rgb', 'rgba'),
    fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2, pointBackgroundColor: color
  }], { animation: { duration: 200 } });
}

function updateLiveChart(meterId) {
  const data = _liveChartData[meterId] || [];
  const ch   = charts['chart-live-flow'];
  if (!ch) { initLiveChart(meterId); return; }
  ch.data.labels = data.map(d => d.t);
  ch.data.datasets[0].data = data.map(d => d.v);
  ch.update('none');
}

function switchLiveChartMeter(meterId) {
  _liveChartMeter = meterId;
  const color = meterId === 'SMT-E-0087' ? '#fbbf24' : '#38bdf8';
  const ch    = charts['chart-live-flow'];
  if (ch) {
    ch.data.datasets[0].borderColor = color;
    ch.data.datasets[0].label = meterId + ' – Value';
  }
  initLiveChart(meterId);
}

// =====================================================================
// CRUD SECTION
// =====================================================================
let _crudTab = 'readings';

function initCrudSection() {
  switchCrudTab(_crudTab);
}

function switchCrudTab(tab) {
  _crudTab = tab;
  document.querySelectorAll('.crud-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.crud-panel').forEach(p => p.classList.remove('active'));
  $('crud-tab-' + tab)?.classList.add('active');
  $('crud-panel-' + tab)?.classList.add('active');
  if (tab === 'readings') loadCrudReadings();
  if (tab === 'meters')   loadCrudMeters();
  if (tab === 'alerts')   loadCrudAlerts();
}

// ---- READINGS CRUD ----
let _crudReadingsPage = 1;
async function loadCrudReadings() {
  const tbody = $('crud-readings-body'); if (!tbody) return;
  const meterId = $('crud-meter-filter')?.value || 'SMT-W-0041';
  const limit   = parseInt($('crud-readings-limit')?.value || '20');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Loading…</td></tr>';
  const data = await apiSafe('usage', `/api/usage/readings/${meterId}?limit=${limit}&page=${_crudReadingsPage}`);
  const rows = data?.data || [];
  const total = data?.total || 0;
  $('readings-count').textContent = total + ' total';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No readings found for this meter.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr id="row-${r.id}">
      <td title="${r.id}">${shortId(r.id)}</td>
      <td style="color:var(--accent-blue)">${r.meter_id}</td>
      <td>${r.type}</td>
      <td class="${r.type === 'energy' ? 'td-energy' : 'td-value'}">${parseFloat(r.value).toFixed(3)} ${r.unit||''}</td>
      <td class="td-pressure">${r.pressure != null ? r.pressure + ' bar' : '—'}</td>
      <td class="${r.quality === 'anomaly' ? 'td-q-anomaly' : 'td-q-normal'}">${r.quality}</td>
      <td>${fmt(r.recorded_at)}</td>
      <td>
        <button class="btn-edit" onclick='openEditReading(${JSON.stringify(r)})'>Edit</button>
        <button class="btn-delete" onclick="deleteReading('${r.id}')">Delete</button>
      </td>
    </tr>`).join('');
  // Pagination
  const pageCount = Math.ceil(total / limit);
  const pag = $('crud-readings-pagination');
  if (pag) {
    pag.innerHTML = '';
    if (pageCount > 1) {
      for (let i=1; i<=Math.min(pageCount, 8); i++) {
        const btn = document.createElement('button');
        btn.className = 'crud-page-btn' + (i === _crudReadingsPage ? ' active' : '');
        btn.textContent = i;
        btn.onclick = () => { _crudReadingsPage = i; loadCrudReadings(); };
        pag.appendChild(btn);
      }
    }
  }
}

// CREATE Reading
function openCreateReading() {
  const meterId = $('crud-meter-filter')?.value || 'SMT-W-0041';
  const isMeter = (id) => id !== 'SMT-E-0087';
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
  // Pre-select current filter
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
    type:    isEnergy ? 'energy' : 'water',
    value,
    userId:  AUTH.userId || 'b1031dfa-00a1-7027-bb09-2f4ed1abb296',
    ...(pressure != null && !isEnergy ? { pressure } : {})
  };
  try {
    await apiFetch('usage', '/api/usage/ingest', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`✓ Reading ingested for ${meterId}`);
    closeCrudModal();
    loadCrudReadings();
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
          <option value="normal" ${r.quality==='normal'?'selected':''}>Normal</option>
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
    showToast('Reading updated');
    closeCrudModal();
    loadCrudReadings();
  } catch (e) {
    // If API doesn't have PUT for readings, update locally for now
    showToast('Note: Update API not available — changes shown locally only');
    const row = $('row-' + id);
    if (row) {
      const cells = row.querySelectorAll('td');
      cells[3].textContent = parseFloat(value).toFixed(3);
      if (pressure !== undefined && cells[4]) cells[4].textContent = pressure + ' bar';
    }
    closeCrudModal();
  }
}

// DELETE Reading
async function deleteReading(id) {
  if (!confirm('Delete this reading permanently?')) return;
  try {
    await apiFetch('usage', `/api/usage/readings/${id}`, { method: 'DELETE' });
    showToast('Reading deleted');
    loadCrudReadings();
  } catch (e) {
    // If DELETE API not available, remove from DOM
    const row = $('row-' + id);
    if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 300); }
    showToast('Removed from view (DELETE API not available)');
  }
}

// ---- METERS CRUD ----
async function loadCrudMeters() {
  const tbody = $('crud-meters-body'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Loading…</td></tr>';
  const data = await apiSafe('usage', '/api/usage/meters');
  const meters = data?.meters || [];
  $('meters-crud-count').textContent = meters.length + ' meters';
  if (!meters.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No meters found.</td></tr>';
    return;
  }
  const stDot = (s) => ({ online:'🟢', warning:'🟡', offline:'🔴' }[s] || '⚪');
  tbody.innerHTML = meters.map(m => `
    <tr id="mrow-${m.id}">
      <td style="color:var(--accent-blue);font-weight:600">${m.id}</td>
      <td>${m.user_name || shortId(m.user_id)}</td>
      <td>${m.type}</td>
      <td>${m.location || '—'}</td>
      <td>${stDot(m.status)} ${m.status}</td>
      <td class="${m.type==='energy'?'td-energy':'td-value'}">${m.latest_value ? parseFloat(m.latest_value).toFixed(2) + ' ' + (m.unit||'') : '—'}</td>
      <td>${fmt(m.last_seen)}</td>
      <td>
        <button class="btn-edit" onclick='openEditMeter(${JSON.stringify(m)})'>Edit</button>
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
    showToast('Meter updated');
    closeCrudModal();
    loadCrudMeters();
  } catch (e) {
    // Update table row locally if API unavailable
    const row = $('mrow-' + id);
    if (row) {
      row.querySelectorAll('td')[3].textContent = location || '—';
      const stDot = { online:'🟢', warning:'🟡', offline:'🔴' }[status] || '⚪';
      row.querySelectorAll('td')[4].textContent = stDot + ' ' + status;
    }
    showToast('Status updated locally');
    closeCrudModal();
  }
}

async function deleteMeter(id) {
  if (!confirm(`Delete meter ${id}? This will also delete all its readings.`)) return;
  try {
    await apiFetch('usage', `/api/usage/meters/${id}`, { method: 'DELETE' });
    showToast('Meter deleted: ' + id);
    loadCrudMeters();
  } catch (e) {
    const row = $('mrow-' + id);
    if (row) { row.style.opacity='0'; setTimeout(() => row.remove(), 300); }
    showToast('Removed from view (DELETE API not available)');
  }
}

// ---- ALERTS CRUD ----
async function loadCrudAlerts() {
  const tbody = $('crud-alerts-body'); if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Loading…</td></tr>';
  const data   = AUTH.demo ? { alerts: MOCK.alerts } : await apiSafe('alert', `/api/alerts/user/${AUTH.userId}`);
  const alerts = data?.alerts || [];
  $('alerts-crud-count').textContent = alerts.length + ' alerts';
  if (!alerts.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No alerts. System is clean ✓</td></tr>';
    return;
  }
  tbody.innerHTML = alerts.map(a => `
    <tr id="arow-${a.id}">
      <td style="font-weight:600;color:var(--text-primary);max-width:180px;white-space:normal">${a.title}</td>
      <td>${a.type || '—'}</td>
      <td class="sev-${a.severity}">${a.severity.toUpperCase()}</td>
      <td style="color:var(--accent-blue)">${a.meter_id || '—'}</td>
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
      body: JSON.stringify({ title, description: desc, severity, type: severity, meter_id: meterId, user_id: AUTH.userId })
    });
    showToast('Alert created');
    closeCrudModal();
    _fullAlerts = null;
    loadCrudAlerts();
  } catch (e) { showToast('Failed: ' + e.message, true); }
}

async function resolveAlert(id) {
  try {
    await apiFetch('alert', `/api/alerts/${id}/resolve`, { method: 'PUT' });
    showToast('Alert resolved ✓');
    _fullAlerts = null;
    loadCrudAlerts();
  } catch (e) {
    const row = $('arow-' + id);
    if (row) {
      const statusCell = row.querySelectorAll('td')[4];
      statusCell.className = 'st-resolved';
      statusCell.textContent = 'resolved';
      const actionCell = row.querySelectorAll('td')[6];
      actionCell.querySelector('.btn-resolve')?.remove();
    }
    showToast('Marked as resolved locally');
  }
}

async function deleteAlert(id) {
  if (!confirm('Delete this alert permanently?')) return;
  try {
    await apiFetch('alert', `/api/alerts/${id}`, { method: 'DELETE' });
    showToast('Alert deleted');
    _fullAlerts = null;
    loadCrudAlerts();
  } catch (e) {
    const row = $('arow-' + id);
    if (row) { row.style.opacity='0'; setTimeout(() => row.remove(), 300); }
    showToast('Removed from view');
  }
}

// ===== MODAL HELPERS =====
function openModal(title, bodyHtml) {
  $('crud-modal-title').textContent = title;
  $('crud-modal-body').innerHTML    = bodyHtml;
  $('crud-modal').style.display     = 'flex';
}
function closeCrudModal() { $('crud-modal').style.display = 'none'; }

// ===== OTHER SECTIONS =====
let currentFilter2 = 'all';
function filterAlerts2(f, btn) { currentFilter = f; filterAlerts(f, btn); }

// ===== BOOT =====
document.addEventListener('DOMContentLoaded', async () => {
  console.log('AquaSense Portal Booting…');

  $('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await handleLogin($('login-email').value.trim(), $('login-password').value);
  });
  $('btn-demo')?.addEventListener('click', enterDemoMode);
  $('btn-forgot-password')?.addEventListener('click', e => { e.preventDefault(); toggleForgotPw(true); });
  $('btn-send-code')?.addEventListener('click', handleForgotPwSend);
  $('btn-confirm-reset')?.addEventListener('click', handleForgotPwConfirm);
  $('link-show-signup')?.addEventListener('click', e => { e.preventDefault(); toggleSignUp(true); });
  $('link-show-login')?.addEventListener('click', e => { e.preventDefault(); toggleSignUp(false); });
  $('signup-form')?.addEventListener('submit', handleSignUp);
  $('btn-verify-submit')?.addEventListener('click', handleVerifyCode);
  $('btn-set-password')?.addEventListener('click', handleSetNewPassword);

  window.addEventListener('popstate', e => {
    const section = e.state?.section || 'dashboard';
    showSection(section);
  });

  // Handle direct URL hash navigation
  const hash = window.location.hash.replace('#', '');
  if (hash && $('section-' + hash)) showSection(hash);

  // Check for saved session
  if (userPool) {
    const loggedIn = await checkExistingAuth();
    if (loggedIn) {
      hideLoginModal();
      initDashboard();
      showSection('dashboard');
      loadDashboardData();
    } else {
      showLoginModal();
    }
  } else {
    showLoginModal();
  }
});
