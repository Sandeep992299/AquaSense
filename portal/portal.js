/* =============================================
   AquaSense Customer Web Portal – JavaScript
   Integrated with AWS Cognito Authentication
   ============================================= */

// ===== CONFIGURATION =====
const SERVICES = window.AQUA_CONFIG || {
  user:    'http://localhost:8081',
  billing: 'http://localhost:8082',
  usage:   'http://localhost:8083',
  alert:   'http://localhost:8084',
  cognito: { region: 'ap-south-1', userPoolId: '', clientId: '' }
};

// ===== UTILS =====
const $ = id => document.getElementById(id);
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));

// ===== COGNITO SETUP =====
let userPool = null;
try {
  if (typeof AmazonCognitoIdentity === 'undefined') {
    console.error('AWS Cognito SDK not loaded. Check index.html script tags.');
  } else {
    const poolData = {
      UserPoolId: SERVICES.cognito.userPoolId,
      ClientId:   SERVICES.cognito.clientId
    };
    userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
    console.log('Cognito User Pool initialized:', SERVICES.cognito.userPoolId);
  }
} catch (e) {
  console.error('Failed to initialize Cognito:', e);
}

// ===== AUTH STATE =====
let AUTH = {
  token:  localStorage.getItem('aqua_token'),
  userId: localStorage.getItem('aqua_userId'),
  user:   null,
  demo:   false,
};

// ===== DATE/TIME =====
function updateDate() {
  const now  = new Date();
  const opts = { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' };
  const el   = $('live-date');
  if (el) el.textContent = now.toLocaleString('en-IN', opts);
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
    console.warn(`[portal] ${svc}${path} unavailable — ${err.message}`);
    // Only show demo notice if no real auth token (not a Cognito user)
    if (!AUTH.token && !AUTH.demo) showDemoNotice();
    if (AUTH.demo) showDemoNotice();
    return fallback;
  }
}

// ===== DEMO MODE NOTICE =====
let _demoNoticeShown = false;
function showDemoNotice() {
  if (_demoNoticeShown) return;
  _demoNoticeShown = true;
  const el = $('demo-notice');
  if (el) {
    el.innerHTML = AUTH.demo
      ? '🎭 Demo Mode — simulated data only. <a href="#" onclick="showLoginModal();return false;">Sign in for live data</a>'
      : '⚠️ Backend services offline — showing cached/simulated data. <a href="https://docs.aws.amazon.com/" target="_blank">View AWS status</a>';
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

// Store cognitoUser for newPasswordRequired flow
let _pendingCognitoUser = null;

async function handleLogin(email, password) {
  const btn = $('btn-login');
  const err = $('login-error');
  btn.textContent = 'Signing in…';
  btn.disabled    = true;
  err.textContent = '';

  if (!userPool) {
    err.textContent = 'Cognito not configured. Check config.js and try Demo Mode.';
    btn.textContent = 'Sign In'; btn.disabled = false; return;
  }

  const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool });

  cognitoUser.authenticateUser(authenticationDetails, {
    onSuccess: async (result) => {
      const idToken = result.getIdToken().getJwtToken();
      AUTH.token = idToken;
      AUTH.demo  = false;
      localStorage.setItem('aqua_token', idToken);

      cognitoUser.getUserAttributes((attrErr, attributes) => {
        if (attrErr || !attributes) {
          AUTH.user = { name: email, role: 'residential' };
        } else {
          const userObj = {};
          attributes.forEach(a => userObj[a.getName()] = a.getValue());
          AUTH.user = { name: userObj.name || email, role: userObj['custom:account_type'] || 'residential', id: userObj.sub };
          AUTH.userId = userObj.sub;
          localStorage.setItem('aqua_userId', AUTH.userId);
        }
        btn.textContent = 'Sign In'; btn.disabled = false;
        hideLoginModal();
        updateUserCard(AUTH.user);
        initDashboard();          // Build DOM first
        showSection('dashboard'); // Then navigate
        loadDashboardData();      // Then fetch live data
      });
    },
    onFailure: (e) => {
      console.error('Cognito login error:', e);
      err.textContent = e.message || 'Sign-in failed. Please check your credentials.';
      btn.textContent = 'Sign In'; btn.disabled = false;
    },
    newPasswordRequired: (userAttributes) => {
      // Admin-created user: must set a permanent password on first login
      _pendingCognitoUser = cognitoUser;
      btn.textContent = 'Sign In'; btn.disabled = false;
      // Show the new-password panel
      $('login-form').style.display = 'none';
      $('new-pw-panel').style.display = 'block';
      if ($('login-title')) $('login-title').textContent = 'Set New Password';
      if ($('login-sub')) $('login-sub').textContent = 'Your admin-assigned password has expired. Set a permanent one.';
    }
  });
}

function handleSignOut() {
  const cognitoUser = userPool?.getCurrentUser();
  if (cognitoUser) cognitoUser.signOut();
  AUTH = { token: null, userId: null, user: null, demo: false };
  localStorage.removeItem('aqua_token');
  localStorage.removeItem('aqua_userId');
  showLoginModal();
}

function handleSetNewPassword() {
  const pw  = $('new-pw-input').value;
  const pw2 = $('new-pw-confirm').value;
  const err = $('login-error');
  if (pw !== pw2) { err.textContent = 'Passwords do not match.'; return; }
  if (!_pendingCognitoUser) { err.textContent = 'Session expired. Please sign in again.'; return; }

  _pendingCognitoUser.completeNewPasswordChallenge(pw, {}, {
    onSuccess: (result) => {
      const idToken = result.getIdToken().getJwtToken();
      AUTH.token = idToken; AUTH.demo = false;
      localStorage.setItem('aqua_token', idToken);
      _pendingCognitoUser.getUserAttributes((attrErr, attributes) => {
        if (!attrErr && attributes) {
          const userObj = {};
          attributes.forEach(a => userObj[a.getName()] = a.getValue());
          AUTH.user = { name: userObj.name || 'User', role: userObj['custom:account_type'] || 'residential', id: userObj.sub };
          AUTH.userId = userObj.sub;
          localStorage.setItem('aqua_userId', AUTH.userId);
        } else {
          AUTH.user = { name: 'User', role: 'residential' };
        }
        _pendingCognitoUser = null;
        $('new-pw-panel').style.display = 'none';
        hideLoginModal();
        updateUserCard(AUTH.user);
        initDashboard();
        showSection('dashboard');
        loadDashboardData();
      });
    },
    onFailure: (e) => {
      $('login-error').textContent = e.message || 'Failed to set password.';
    }
  });
}

function enterDemoMode() {
  AUTH = { token: null, userId: 'a0000001-0000-0000-0000-000000000001', user: { name: 'Demo User', role: 'residential' }, demo: true };
  localStorage.removeItem('aqua_token');
  localStorage.removeItem('aqua_userId');
  hideLoginModal();
  showDemoNotice();
  updateUserCard(AUTH.user);
  initDashboard();
}

async function checkExistingAuth() {
  const cognitoUser = userPool.getCurrentUser();
  if (!cognitoUser) return false;

  return new Promise((resolve) => {
    cognitoUser.getSession((err, session) => {
      if (err || !session.isValid()) {
        resolve(false);
        return;
      }
      
      AUTH.token = session.getIdToken().getJwtToken();
      localStorage.setItem('aqua_token', AUTH.token);

      cognitoUser.getUserAttributes((err, attributes) => {
        if (err) {
          resolve(false);
        } else {
          const userObj = {};
          attributes.forEach(attr => userObj[attr.getName()] = attr.getValue());
          AUTH.user = { 
            name: userObj.name, 
            role: userObj['custom:account_type'] || 'residential',
            id: userObj.sub
          };
          AUTH.userId = userObj.sub;
          localStorage.setItem('aqua_userId', AUTH.userId);
          updateUserCard(AUTH.user);
          resolve(true);
        }
      });
    });
  });
}

// ===== FORGOT PASSWORD LOGIC =====
function toggleForgotPw(show) {
  $('login-form').style.display = show ? 'none' : 'block';
  $('forgot-pw-panel').style.display = show ? 'block' : 'none';
  $('login-title').textContent = show ? 'Reset Password' : 'Welcome back';
}

function handleForgotPwSend() {
  const email = $('forgot-email').value.trim();
  if (!email) return alert('Enter email');
  
  const userData = { Username: email, Pool: userPool };
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

  cognitoUser.forgotPassword({
    onSuccess: (data) => { console.log('Code sent'); },
    onFailure: (err) => { alert(err.message || JSON.stringify(err)); },
    inputVerificationCode: (data) => {
      $('forgot-confirm-panel').style.display = 'block';
      $('btn-send-code').textContent = 'Code Sent';
    }
  });
}

function handleForgotPwConfirm() {
  const email = $('forgot-email').value.trim();
  const code = $('forgot-code').value.trim();
  const newPw = $('forgot-new-pw').value;
  
  const userData = { Username: email, Pool: userPool };
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

  cognitoUser.confirmPassword(code, newPw, {
    onSuccess: () => {
      alert('Password reset successful! You can now sign in.');
      toggleForgotPw(false);
    },
    onFailure: (err) => { alert(err.message || JSON.stringify(err)); }
  });
}

// ===== COGNITO SIGN UP / VERIFY =====

function toggleSignUp(show) {
  $('login-form').style.display = show ? 'none' : 'block';
  $('signup-panel').style.display = show ? 'block' : 'none';
  $('btn-demo').style.display = show ? 'none' : 'block';
  if ($('login-divider')) $('login-divider').style.display = show ? 'none' : 'block';
  if ($('login-footer-signin')) $('login-footer-signin').style.display = show ? 'none' : 'block';
  if ($('login-title')) $('login-title').textContent = show ? 'Create Account' : 'Welcome back';
  if ($('login-sub')) $('login-sub').textContent = show ? 'Join the AquaSense network' : 'Securely access your water usage dashboard';
}

async function handleSignUp(e) {
  e.preventDefault();
  const name = $('signup-name').value;
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const meter = $('signup-meter').value;
  
  const btn = $('btn-signup-submit');
  const err = $('login-error');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  err.textContent = '';

  const attributeList = [
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'name', Value: name }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'custom:meter_id', Value: meter || 'pending' }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'custom:account_type', Value: 'residential' })
  ];

  userPool.signUp(email, password, attributeList, null, (err, result) => {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    if (err) {
      $('login-error').textContent = err.message || JSON.stringify(err);
      return;
    }
    // Show verification panel
    $('signup-panel').style.display = 'none';
    $('verify-panel').style.display = 'block';
    $('login-title').textContent = 'Verify Email';
  });
}

async function handleVerifyCode() {
  const emailVal = $('signup-email').value.trim() || $('login-email').value.trim();
  const code = $('verify-code').value.trim();
  const errEl = $('login-error');

  if (!userPool) { errEl.textContent = 'Cognito not configured.'; return; }

  const userData = { Username: emailVal, Pool: userPool };
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

  cognitoUser.confirmRegistration(code, true, (cbErr, result) => {
    if (cbErr) {
      errEl.textContent = cbErr.message || JSON.stringify(cbErr);
      return;
    }
    alert('✅ Account verified! You can now sign in.');
    toggleSignUp(false);
    $('verify-panel').style.display = 'none';
  });
}

// ===== NAV =====
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('section-' + name)?.classList.add('active');
  $('nav-' + name)?.classList.add('active');
  $('page-title').textContent = {
    dashboard:'Dashboard', water:'Water Usage', energy:'Energy Monitor',
    alerts:'Alerts', reports:'Reports', meters:'My Meters'
  }[name] || name;
  // Browser history support
  history.pushState({ section: name }, '', '#' + name);
  initSectionCharts(name);
}


function toggleSidebar() { $('sidebar')?.classList.toggle('open'); }

// ===== SPARKLINE HELPER =====
function makeSparkline(id, data, color) {
  const ctx = $(id)?.getContext('2d');
  if (!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_,i) => i),
      datasets: [{ data, borderColor: color, borderWidth: 1.5, pointRadius: 0, fill: true,
        backgroundColor: ctx => {
          const gr = ctx.chart.ctx.createLinearGradient(0,0,0,36);
          gr.addColorStop(0, color + '55'); gr.addColorStop(1, color + '00'); return gr;
        }
      }]
    },
    options: { animation:false, plugins:{ legend:{display:false}, tooltip:{enabled:false} },
      scales:{ x:{display:false}, y:{display:false} }, responsive:true, maintainAspectRatio:false }
  });
}

// ===== DATA GENERATORS (fallback simulation) =====
function generateHourly(base, noise, points=24) {
  return Array.from({length:points}, (_,i) => Math.max(0, base + Math.sin(i/4)*base*0.3 + rand(-noise,noise)));
}
function generateDays(base, noise, points=7) {
  return Array.from({length:points}, () => Math.max(0, base + rand(-noise, noise)));
}

// ===== CHART HELPERS =====
const charts = {};

function makeLineChart(id, labels, datasets, opts={}) {
  const ctx = $(id)?.getContext('2d');
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: { duration: 600 },
      plugins: { legend: { labels: { color:'#94a3b8', font:{size:11}, boxWidth:12 } } },
      scales: {
        x: { ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.05)' } },
        y: { ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.05)' } }
      },
      responsive:true, maintainAspectRatio:true, ...opts
    }
  });
  return charts[id];
}

function makeDoughnut(id, labels, data, colors) {
  const ctx = $(id)?.getContext('2d');
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets:[{ data, backgroundColor:colors, borderColor:'#0d1626', borderWidth:2, hoverOffset:6 }] },
    options: {
      cutout:'62%',
      plugins:{ legend:{ position:'bottom', labels:{ color:'#94a3b8', font:{size:11}, boxWidth:10, padding:10 } } },
      responsive:true, maintainAspectRatio:false
    }
  });
}

// ===== MOCK FALLBACK DATA =====
const MOCK = {
  waterToday: 284, energyToday: 18.4, pressure: 2.4, bill: 1842,
  alerts: [
    { severity:'critical', title:'Leakage Detected – Zone C', description:'Flow sensor ASM-LK-007 registered abnormal delta. Possible pipe leak.', created_at:new Date(Date.now()-7200000).toISOString(), status:'active' },
    { severity:'warning',  title:'High Water Consumption',   description:'Daily usage exceeded 120% of baseline target.', created_at:new Date(Date.now()-86400000).toISOString(), status:'active' },
    { severity:'warning',  title:'Energy Spike Detected',    description:'Consumption spike of 3.8 kW between 14:00–15:30.', created_at:new Date(Date.now()-172800000).toISOString(), status:'active' },
    { severity:'info',     title:'Monthly Bill Generated',   description:'Your April 2026 bill of ₹1,842 has been generated.', created_at:new Date(Date.now()-259200000).toISOString(), status:'active' },
    { severity:'info',     title:'Meter Firmware Updated',   description:'Smart meters received OTA firmware v3.7.1.', created_at:new Date(Date.now()-345600000).toISOString(), status:'active' },
    { severity:'info',     title:'Backup Completed',         description:'Daily snapshot and S3 data archive completed.', created_at:new Date(Date.now()-432000000).toISOString(), status:'active' },
  ],
  meters: [
    { id:'SMT-W-0041', type:'water',  location:'Kitchen Block, Unit A',  status:'online',  latest_value:284,  unit:'L',   pressure:2.4 },
    { id:'SMT-W-0042', type:'water',  location:'Garden Zone South',       status:'online',  latest_value:45,   unit:'L',   pressure:1.8 },
    { id:'SMT-E-0087', type:'energy', location:'Distribution Board',      status:'online',  latest_value:18.4, unit:'kWh', pressure:null },
    { id:'SMT-W-0043', type:'water',  location:'Factory Main Supply',     status:'warning', latest_value:112,  unit:'L',   pressure:0.9 },
    { id:'SMT-E-0088', type:'energy', location:'HVAC Unit',               status:'online',  latest_value:7.2,  unit:'kWh', pressure:null },
    { id:'SMT-W-0044', type:'water',  location:'Backup Supply',           status:'offline', latest_value:0,    unit:'L',   pressure:0 },
  ],
};

const ALERT_ICON = { critical:'🚨', warning:'⚠️', info:'📋' };

// ===== DASHBOARD DATA LOAD (live APIs) =====
async function loadDashboardData() {
  if (AUTH.demo) return;
  
  // Usage summary → KPI water + energy
  const summary = await apiSafe('usage', `/api/usage/summary/${AUTH.userId}`);
  if (summary?.summary) {
    const s = summary.summary;
    const waterVal  = parseFloat(s.today_water_l)   || MOCK.waterToday;
    const energyVal = parseFloat(s.today_energy_kwh) || MOCK.energyToday;
    animCount('kpi-water',    0,   waterVal,  'L',   1200);
    animCount('kpi-energy',   0,   energyVal, 'kWh', 1200, 1);
    animCount('kpi-pressure', 2.0, MOCK.pressure, 'bar', 800, 1);
  } else {
    animCount('kpi-water',    0,   MOCK.waterToday,  'L',   1200);
    animCount('kpi-energy',   0,   MOCK.energyToday, 'kWh', 1200, 1);
    animCount('kpi-pressure', 2.0, MOCK.pressure,    'bar', 800,  1);
  }

  // Bill estimate from billing-service
  const billsData = await apiSafe('billing', `/api/bills/user/${AUTH.userId}`);
  if (billsData?.bills?.length) {
    const latest = billsData.bills[0];
    const el = $('kpi-bill');
    if (el) el.innerHTML = `₹ ${parseFloat(latest.total).toLocaleString('en-IN')}`;
  } else {
    const el = $('kpi-bill');
    if (el) el.innerHTML = `₹ ${MOCK.bill.toLocaleString('en-IN')}`;
  }

  // Alerts count + dashboard card
  const alertsData = await apiSafe('alert', `/api/alerts/user/${AUTH.userId}`);
  const alertList  = alertsData?.alerts || null;
  const badge      = $('alert-badge');
  if (badge) badge.textContent = alertsData?.active ?? 3;
  renderDashboardAlerts(alertList);
}

// ===== INIT DASHBOARD =====
let _dashboardInited = false;
let waterChartDays   = 7;

function initDashboard() {
  if (_dashboardInited) return;
  _dashboardInited = true;

  makeSparkline('spark-water',    generateDays(280,40), '#38bdf8');
  makeSparkline('spark-energy',   generateDays(18, 4),  '#fbbf24');
  makeSparkline('spark-pressure', generateDays(2.3,0.3),'#a78bfa');
  makeSparkline('spark-bill',     generateDays(1800,200),'#34d399');
  renderWaterChart(7);
  renderBreakdownChart();
  startLiveFeed();

  // Defaults while API loads
  animCount('kpi-pressure', 2.0, MOCK.pressure, 'bar', 800, 1);
  $('kpi-bill').innerHTML = `₹ ${MOCK.bill.toLocaleString('en-IN')}`;

  if (!AUTH.demo) {
    loadDashboardData();
  } else {
    animCount('kpi-water',  0, MOCK.waterToday,  'L',   1200);
    animCount('kpi-energy', 0, MOCK.energyToday, 'kWh', 1200, 1);
    renderDashboardAlerts(null);
    $('alert-badge').textContent = MOCK.alerts.filter(a=>a.status==='active').length;
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
    { label:'Target (L)',      data:Array(days).fill(300), borderColor:'rgba(52,211,153,0.5)', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false, tension:0 }
  ]);
}

function setWaterRange(days, btn) {
  waterChartDays = days;
  document.querySelectorAll('.chart-controls .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderWaterChart(days);
}

function renderBreakdownChart() {
  makeDoughnut('chart-breakdown',
    ['Kitchen','Bathroom','Garden','Laundry'],
    [31, 44, 15, 10],
    ['#38bdf8','#06b6d4','#34d399','#a78bfa']
  );
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

// ===== LIVE FEED =====
const feedEvents = [
  { msg:'Flow sensor ASM-W-001 reading normal',         color:'#34d399' },
  { msg:'Pressure @ Zone-B: 2.4 bar – OK',              color:'#38bdf8' },
  { msg:'Smart meter SMT-W-0041 data synced',           color:'#a78bfa' },
  { msg:'Lambda anomaly-detector invoked (OK)',          color:'#fbbf24' },
  { msg:'Aurora DB heartbeat confirmed',                color:'#34d399' },
  { msg:'IoT Core rule triggered – DynamoDB write',     color:'#38bdf8' },
  { msg:'SNS alert dispatched to endpoint',             color:'#fb923c' },
  { msg:'ECS task aqua-usage-svc healthy',              color:'#34d399' },
  { msg:'Kinesis shard ingested 120 records',           color:'#a78bfa' },
  { msg:'CloudWatch alarm OK state',                    color:'#34d399' },
];
let feedIdx = 0;

function addFeedItem() {
  const feed = $('live-feed'); if (!feed) return;
  const ev   = feedEvents[feedIdx++ % feedEvents.length];
  const now  = new Date().toLocaleTimeString('en-IN');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `<span class="feed-dot" style="background:${ev.color};box-shadow:0 0 6px ${ev.color}"></span>
    <span>${ev.msg}</span>
    <span class="feed-meta">${now}</span>`;
  feed.insertBefore(item, feed.firstChild);
  if (feed.children.length > 8) feed.lastChild.remove();
}
function startLiveFeed() { addFeedItem(); setInterval(addFeedItem, 2800); }

// ===== ALERTS =====
function alertIcon(severity) { return ALERT_ICON[severity] || '📌'; }
function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff/60000); const h = Math.floor(m/60); const d = Math.floor(h/24);
  return d>0 ? `${d}d ago` : h>0 ? `${h}h ago` : m>0 ? `${m}m ago` : 'just now';
}

function renderDashboardAlerts(alerts) {
  const el = $('dashboard-alerts'); if (!el) return;
  el.innerHTML = '';
  const list = (alerts || MOCK.alerts).slice(0, 3);
  list.forEach(a => {
    el.innerHTML += `<div class="alert-item ${a.severity}">
      <span class="alert-icon">${alertIcon(a.severity)}</span>
      <div class="alert-body">
        <div class="alert-title">${a.title}</div>
        <div class="alert-time">${timeAgo(a.created_at)}</div>
      </div>
    </div>`;
  });
}

let currentFilter = 'all';
let _fullAlerts   = null;

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
  const filtered = filter==='all' ? allAlerts : allAlerts.filter(a => a.severity===filter || a.type===filter);
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
}

function initWaterSection() {
  const months30 = Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-29+i);return d.getDate()+'/'+ d.toLocaleString('en-IN',{month:'short'});});
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
  makeDoughnut('chart-energy-mix',
    ['Grid','Solar','Off-Peak','Battery'],
    [55, 22, 15, 8],
    ['#fbbf24','#34d399','#38bdf8','#fb923c']
  );
}

// ===== REPORTS =====
const reports = [
  { icon:'💧', title:'April 2026 – Water Report',    meta:'Generated Apr 12 · PDF · 1.2MB', dl:'Download PDF' },
  { icon:'⚡', title:'April 2026 – Energy Report',   meta:'Generated Apr 12 · PDF · 980KB', dl:'Download PDF' },
  { icon:'📊', title:'Q1 2026 Usage Analytics',      meta:'Generated Apr 1 · PDF · 3.1MB',  dl:'Download PDF' },
  { icon:'💰', title:'March 2026 Bill Statement',    meta:'Generated Mar 31 · PDF · 450KB', dl:'Download PDF' },
  { icon:'🔍', title:'Anomaly Detection Log',        meta:'Generated Apr 10 · CSV · 220KB', dl:'Download CSV' },
  { icon:'📈', title:'Demand Forecast – May 2026',   meta:'Generated Apr 11 · XLSX · 1.8MB',dl:'Download XLSX'},
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
      </div>
    </div>`;
  });
}

// ===== METERS (live) =====
async function loadAndRenderMeters() {
  const el = $('meters-grid'); if (!el || el.innerHTML) return;
  el.innerHTML = '<div style="color:#4a5568;padding:20px">Loading meters…</div>';

  const data   = AUTH.demo ? null : await apiSafe('usage', '/api/usage/meters');
  const meters = data?.meters || MOCK.meters;
  el.innerHTML = '';

  meters.forEach(m => {
    const statusIcon = { online:'🟢', warning:'🟡', offline:'🔴' }[m.status] || '⚪';
    const isWater    = m.type === 'water';
    const val        = m.latest_value ?? 0;
    const pct = m.status === 'offline' ? 0 : isWater ? Math.min(100,(val/350)*100) : Math.min(100,(val/25)*100);
    let readings = '';
    if (isWater)          readings += `<div class="reading-row"><span class="reading-label">Flow Rate</span><span class="reading-val" style="color:#38bdf8">${val} ${m.unit||'L'}</span></div>`;
    if (m.pressure!=null) readings += `<div class="reading-row"><span class="reading-label">Pressure</span><span class="reading-val" style="color:#a78bfa">${m.pressure} bar</span></div>`;
    if (!isWater)         readings += `<div class="reading-row"><span class="reading-label">Energy</span><span class="reading-val" style="color:#fbbf24">${val} ${m.unit||'kWh'}</span></div>`;
    el.innerHTML += `<div class="meter-card">
      <div class="meter-header">
        <span class="meter-id">${m.id}</span>
        <span class="meter-status ${m.status}"><span class="status-dot"></span>${m.status.toUpperCase()}</span>
      </div>
      <div class="meter-name">${statusIcon} ${m.user_name ? m.user_name + ' – ' : ''}${m.type==='water'?'Water Meter':'Energy Meter'}</div>
      <div class="meter-location">📍 ${m.location || '—'}</div>
      <div class="meter-bar"><div class="meter-bar-fill" style="width:${pct}%"></div></div>
      <div class="meter-readings">${readings}</div>
    </div>`;
  });
}

// ===== BOOT =====
document.addEventListener('DOMContentLoaded', async () => {
  console.log('AquaSense Portal Booting...');
  
  // Wire login form
  $('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await handleLogin($('login-email').value.trim(), $('login-password').value);
  });
  $('btn-demo')?.addEventListener('click', enterDemoMode);
  
  // Wire forgot password
  $('btn-forgot-password')?.addEventListener('click', e => { 
    console.log('Forgot password clicked');
    e.preventDefault(); 
    toggleForgotPw(true); 
  });
  $('btn-send-code')?.addEventListener('click', handleForgotPwSend);
  $('btn-confirm-reset')?.addEventListener('click', handleForgotPwConfirm);

  // Wire Sign Up
  $('link-show-signup')?.addEventListener('click', e => {
    console.log('Sign up clicked');
    e.preventDefault();
    toggleSignUp(true);
  });
  $('link-show-login')?.addEventListener('click', e => {
    e.preventDefault();
    toggleSignUp(false);
  });
  $('signup-form')?.addEventListener('submit', handleSignUp);
  $('btn-verify-submit')?.addEventListener('click', handleVerifyCode);
  $('btn-set-password')?.addEventListener('click', handleSetNewPassword);


  // Browser back button support
  window.addEventListener('popstate', e => {
    const section = e.state?.section || 'dashboard';
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    $('section-' + section)?.classList.add('active');
    $('nav-' + section)?.classList.add('active');
    if ($('page-title')) $('page-title').textContent = section.charAt(0).toUpperCase() + section.slice(1);
    initSectionCharts(section);
  });

  // Check for saved session
  if (userPool) {
    const loggedIn = await checkExistingAuth();
    if (loggedIn) {
      hideLoginModal();
      initDashboard();
      showSection('dashboard');
    } else {
      showLoginModal();
    }
  } else {
    showLoginModal();
  }
});
