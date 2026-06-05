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
    water:'Water Usage', energy:'Energy Monitor', alerts:'Alerts', reports:'Reports',
    meters:'My Meters', billing:'Billing & Payments'
  }[name] || name;
  history.pushState({ section: name }, '', '#' + name);
  // Initialize section-specific content
  if (name === 'live')      initLiveSection();
  if (name === 'crud')      initCrudSection();
  if (name === 'water')     initWaterSection();
  if (name === 'energy')    initEnergySection();
  if (name === 'alerts')    renderFullAlerts(currentFilter);
  if (name === 'reports')   renderReports();
  if (name === 'meters')    loadAndRenderMeters();
  if (name === 'billing')   initBillingSection();
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
// Values aligned with seed.sql: LKR tariff, Rajesh Kumar residential readings
const MOCK = {
  // Today's readings: avg of SMT-W-0041 (Kitchen) + SMT-W-0042 (Garden)
  waterToday:  274,   // ~270 L/day combined (Kitchen 180 + Garden 90)
  energyToday: 14.2,  // ~14 kWh/day (SMT-E-0087)
  pressure:    2.4,   // typical bar reading
  bill:        4330,  // May 2026 bill total (LKR)
  alerts:[
    { severity:'critical', title:'Leakage Detected – Kitchen (SMT-W-0041)',     description:'Flow sensor registered 0.4 L/hr at 02:45 AM. Possible pipe leak.', created_at:new Date(Date.now()-7200000).toISOString(), status:'active' },
    { severity:'warning',  title:'High Water Consumption – Garden Zone',        description:'SMT-W-0042 exceeded daily baseline by 140%. Current: 186 L.', created_at:new Date(Date.now()-64800000).toISOString(), status:'active' },
    { severity:'info',     title:'Monthly Bill Generated – May 2026',           description:'Your bill for May 2026 has been generated: LKR 4,330.00. Due: 15 Jun 2026.', created_at:new Date(Date.now()-345600000).toISOString(), status:'active' },
  ],
  // 30-day water readings per meter (L per day) – realistic Kitchen+Garden data
  waterDays30: {
    'SMT-W-0041': [168,182,195,171,188,176,163,197,184,172,191,179,168,185,193,176,168,189,174,182,196,170,183,175,188,165,192,178,186,177],
    'SMT-W-0042': [88,96,92,84,101,89,78,95,93,87,103,91,82,97,89,94,86,99,88,92,104,87,95,90,97,83,102,91,89,94],
  },
  // 30-day energy readings (kWh per day) – SMT-E-0087
  energyDays30: [13.2,14.8,12.9,15.1,13.7,14.4,12.8,15.6,13.9,14.2,13.5,15.0,13.1,14.7,12.6,15.3,13.8,14.5,13.0,15.2,13.4,14.9,12.7,15.4,13.6,14.3,12.5,15.5,13.3,14.1],
  // 24-hour pressure trace (bar)
  pressureHours: [2.3,2.2,2.1,2.0,2.1,2.2,2.3,2.4,2.5,2.6,2.5,2.4,2.4,2.5,2.6,2.5,2.4,2.3,2.2,2.3,2.4,2.3,2.3,2.4],
};
const ALERT_ICON = { critical:'🚨', warning:'⚠️', info:'📋' };

// ===== DASHBOARD DATA =====
async function loadDashboardData() {
  const summary = await apiSafe('usage', `/api/usage/summary/${AUTH.userId}`);
  const s = summary?.summary;

  // --- Water KPI ---
  const todayWater = s?.today_water_l ? parseFloat(s.today_water_l) : MOCK.waterToday;
  animCount('kpi-water', 0, todayWater, 'L', 1200);
  makeSparkline('spark-water', (() => {
    // Build 7-day spark from seeded daily totals
    const d30 = (MOCK.waterDays30['SMT-W-0041'] || []).map((v,i) => v + (MOCK.waterDays30['SMT-W-0042']?.[i] || 0));
    return d30.slice(-7);
  })(), '#38bdf8');

  // --- Energy KPI ---
  const todayEnergy = s?.today_energy_kwh ? parseFloat(s.today_energy_kwh) : MOCK.energyToday;
  animCount('kpi-energy', 0, todayEnergy, 'kWh', 1200, 1);
  makeSparkline('spark-energy', MOCK.energyDays30.slice(-7), '#fbbf24');

  // --- Pressure KPI ---
  const pressure = s?.latest_pressure ?? MOCK.pressure;
  animCount('kpi-pressure', 2.0, parseFloat(pressure), 'bar', 800, 1);
  makeSparkline('spark-pressure', MOCK.pressureHours.slice(-7).map(v => v + (Math.random()-0.5)*0.1), '#a78bfa');

  // --- Bill KPI ---
  const billsData = await apiSafe('billing', `/api/bills/user/${AUTH.userId}`);
  const latestBill = billsData?.bills?.[0];
  const billTotal  = latestBill ? parseFloat(latestBill.total) : MOCK.bill;
  const kpiBill = $('kpi-bill');
  if (kpiBill) kpiBill.innerHTML = `LKR ${billTotal.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
  makeSparkline('spark-bill',
    (billsData?.bills || []).slice(0, 7).map(b => parseFloat(b.total)).reverse() ||
    MOCK.energyDays30.slice(-7).map(v => v * 310),
    '#34d399');

  // --- Alerts ---
  const alertsData = await apiSafe('alert', `/api/alerts/user/${AUTH.userId}`);
  const badge = $('alert-badge');
  if (badge) badge.textContent = alertsData?.active ?? alertsData?.alerts?.filter(a => a.status === 'active').length ?? MOCK.alerts.length;
  renderDashboardAlerts(alertsData?.alerts || null);
}

// ===== INIT DASHBOARD =====
let _dashboardInited = false;
function initDashboard() {
  if (_dashboardInited) return;
  _dashboardInited = true;

  // Kick off live feed and water/breakdown charts
  renderWaterChart(7);
  renderBreakdownChart();
  startLiveFeed();

  // Kick off data load (works for both demo and authenticated mode)
  loadDashboardData();
  if (!AUTH.demo) {
    setInterval(loadDashboardData, 30000); // refresh every 30s
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

async function initWaterSection() {
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

  // ── Update stat tiles dynamically ───────────────────────────────
  // Monthly total: sum all non-null values from both meters over 30 days
  const combined = kitchenData.map((k, i) => (k || 0) + (gardenData[i] || 0));
  const monthlyTotal = combined.reduce((s, v) => s + v, 0);
  const dailyAvg     = monthlyTotal / 30;
  const LKR_RATE_WATER = 9.50; // LKR per 1000 L (approx NWSDB slab)
  const monthlyCostLKR = (monthlyTotal / 1000) * LKR_RATE_WATER;

  // Update stat tiles (they may or may not exist in current HTML)
  const elMonthly = $('water-stat-monthly');
  const elAvg     = $('water-stat-avg');
  const elCost    = $('water-stat-cost');
  if (elMonthly) elMonthly.textContent = monthlyTotal.toFixed(0) + ' L';
  if (elAvg)     elAvg.textContent     = dailyAvg.toFixed(0) + ' L';
  if (elCost)    elCost.textContent    = 'LKR ' + monthlyCostLKR.toFixed(0);

  // ── Daily Consumption chart ──────────────────────────────────────
  makeLineChart('chart-water-detail', months30, [
    { label:'Kitchen (L)',  data: kitchenData, borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.12)', fill:true, tension:0.4, borderWidth:2, pointRadius:2, pointBackgroundColor:'#38bdf8' },
    { label:'Garden (L)',   data: gardenData,  borderColor:'#06b6d4', backgroundColor:'rgba(6,182,212,0.07)',  fill:true, tension:0.4, borderWidth:1.5, pointRadius:0 },
    { label:'Total (L)',    data: combined,    borderColor:'rgba(52,211,153,0.7)', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false },
    { label:'Target (L)',  data: Array(30).fill(270), borderColor:'rgba(248,113,113,0.4)', borderDash:[3,3], borderWidth:1, pointRadius:0, fill:false },
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

async function initEnergySection() {
  // Fetch real energy readings; fall back to seed-derived MOCK data
  const energyRes = await apiSafe('usage', `/api/usage/readings/SMT-E-0087?limit=120`);

  const hours = Array.from({ length: 24 }, (_, i) => i + ':00');

  // Build hourly data (today's readings if available)
  let hourlyData = MOCK.pressureHours.map(v => +(v * 1.5 + Math.random() * 0.5).toFixed(2)); // ~3-4 kWh/slot
  if (energyRes?.data?.length) {
    const today = new Date().toDateString();
    const todayReadings = energyRes.data.filter(r => new Date(r.recorded_at).toDateString() === today);
    if (todayReadings.length >= 3) {
      // Map to 24 hour slots
      hourlyData = Array(24).fill(null);
      todayReadings.forEach(r => {
        const h = new Date(r.recorded_at).getHours();
        hourlyData[h] = parseFloat(r.value);
      });
      // Fill nulls with interpolated average
      const avg = todayReadings.reduce((s, r) => s + parseFloat(r.value), 0) / todayReadings.length;
      hourlyData = hourlyData.map(v => v ?? +(avg * (0.8 + Math.random() * 0.4)).toFixed(2));
    }
  }

  makeLineChart('chart-energy-hourly', hours, [
    { label:'kWh', data: hourlyData, borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 }
  ]);

  // Energy mix: based on typical Sri Lanka residential split
  makeDoughnut('chart-energy-mix',
    ['Grid (CEB)', 'Solar', 'Off-Peak', 'Battery'],
    [58, 20, 15, 7],
    ['#fbbf24', '#34d399', '#38bdf8', '#fb923c']
  );
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
// LIVE TELEMETRY SECTION  →  see portal/live.js
// CRUD / DATA MANAGEMENT  →  see portal/crud.js
// The functions below (initLiveSection, initCrudSection, etc.) are
// defined in their respective module files and called from showSection().
// =====================================================================

// ===== OTHER SECTIONS =====
let currentFilter2 = 'all';
function filterAlerts2(f, btn) { currentFilter = f; filterAlerts(f, btn); }

// =====================================================================
// BILLING & PAYMENTS SECTION
// =====================================================================
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

let _billingInited   = false;
let _billingTab      = 'overview';
let _billingBills    = null;
let _billingRates    = null;

function initBillingSection() {
  if (_billingInited) return;
  _billingInited = true;
  switchBillingTab('overview');
}

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

// ---- OVERVIEW ----
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

  // Unpaid badge in sidebar
  const badgeEl = $('billing-unpaid-badge');
  if (badgeEl) { badgeEl.textContent = unpaidCount; badgeEl.style.display = unpaidCount > 0 ? 'inline-block' : 'none'; }

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
    const rateW = parseFloat(_billingRates.find(r=>r.resource_type==='water')?.rate_per_unit || 0.09);
    const rateE = parseFloat(_billingRates.find(r=>r.resource_type==='energy')?.rate_per_unit || 2.82);
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

// ---- PAST BILLS TABLE ----
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
    // In demo or if API unavailable, simulate payment
    showToast('✓ Payment recorded (demo/offline)');
  }
  // Update row in DOM immediately
  const row = $('bill-row-' + billId);
  if (row) {
    const cells = row.querySelectorAll('td');
    cells[7].innerHTML = '<span class="bill-status-paid">✓ PAID</span>';
    cells[8].innerHTML = '<span style="color:var(--text-muted);font-size:11px">—</span>';
  }
  // Reset cache so next load re-fetches
  _billingBills = null;
  // Refresh sidebar badge
  loadBillingOverview();
}

// ---- USAGE BREAKDOWN ----
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
  const rateW = parseFloat(_billingRates.find(r=>r.resource_type==='water')?.rate_per_unit   || 0.09);
  const rateE = parseFloat(_billingRates.find(r=>r.resource_type==='energy')?.rate_per_unit  || 2.82);
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

  // Trend chart (last 6 months of bills)
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

// ---- FORECAST ----
async function renderBillForecast() {
  if (!_billingBills) {
    const res = AUTH.demo ? { bills: MOCK_BILLS } : await apiSafe('billing', `/api/bills/user/${AUTH.userId}`, { bills: MOCK_BILLS });
    _billingBills = res?.bills || MOCK_BILLS;
  }
  if (!_billingRates) {
    const ratesRes = AUTH.demo ? { rates: MOCK_RATES } : await apiSafe('billing', '/api/billing/rates', { rates: MOCK_RATES });
    _billingRates = ratesRes?.rates || MOCK_RATES;
  }

  const rateW = parseFloat(_billingRates.find(r=>r.resource_type==='water')?.rate_per_unit  || 0.09);
  const rateE = parseFloat(_billingRates.find(r=>r.resource_type==='energy')?.rate_per_unit || 2.82);

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
  // Pad actual data with nulls at forecast positions
  const actualPadded   = [...actualTotals, null, null, null];
  // Pad forecast data — start overlap at last actual
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

// ---- BILLING DATE UTILS ----
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
