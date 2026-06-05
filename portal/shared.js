/* =============================================
   AquaSense – Shared JS
   Must be loaded FIRST on every page.
   Provides: CONFIG, AUTH, Cognito, API helpers,
   MOCK data, chart utilities, sidebar + auth UI.
   ============================================= */

// ── Config & Constants ────────────────────────────────────────
const CONFIG    = window.AQUA_CONFIG || {};
const ALB       = CONFIG.baseUrl || 'http://tf-aqua-sense-production-alb-840180883.ap-south-1.elb.amazonaws.com';
const SERVICES  = {
  user:    ALB,
  billing: ALB,
  usage:   ALB,
  alert:   ALB,
  cognito: CONFIG.cognito || { region:'ap-south-1', userPoolId:'', clientId:'' }
};
const MY_METERS = ['SMT-W-0041','SMT-W-0042','SMT-E-0087'];

// ── Utils ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
       + ' ' + d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
}
function shortId(id) { return id ? id.substring(0,8) + '…' : '—'; }
function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff/60000), h = Math.floor(m/60), d = Math.floor(h/24);
  return d>0 ? `${d}d ago` : h>0 ? `${h}h ago` : m>0 ? `${m}m ago` : 'just now';
}

// ── Cognito Setup ─────────────────────────────────────────────
let userPool = null;
try {
  if (typeof AmazonCognitoIdentity !== 'undefined') {
    userPool = new AmazonCognitoIdentity.CognitoUserPool({
      UserPoolId: SERVICES.cognito.userPoolId,
      ClientId:   SERVICES.cognito.clientId
    });
  }
} catch(e) { console.error('Cognito init failed:', e); }

// ── Auth State ────────────────────────────────────────────────
let AUTH = {
  token:  localStorage.getItem('aqua_token'),
  userId: localStorage.getItem('aqua_userId'),
  user:   null,
  demo:   false
};

// ── API Helpers ───────────────────────────────────────────────
async function apiFetch(svc, path, opts = {}) {
  const headers = { 'Content-Type':'application/json', ...(opts.headers||{}) };
  if (AUTH.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const res = await fetch(SERVICES[svc] + path, { ...opts, headers });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

async function apiSafe(svc, path, fallback = null, fetchOpts = {}) {
  try { return await apiFetch(svc, path, fetchOpts); }
  catch(err) {
    console.warn(`[aqua] ${svc}${path} → ${err.message}`);
    if (!AUTH.token && !AUTH.demo) showDemoNotice();
    if (AUTH.demo) showDemoNotice();
    return fallback;
  }
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'crud-toast' + (isError ? ' error' : '');
  el.innerHTML = (isError ? '✕ ' : '✓ ') + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Demo Notice ───────────────────────────────────────────────
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

// ── MOCK Data (seed-aligned) ──────────────────────────────────
const MOCK = {
  waterToday:  274,
  energyToday: 14.2,
  pressure:    2.4,
  bill:        4330,
  alerts: [
    { id:'mock-1', severity:'critical', type:'leakage',         title:'Leakage Detected – Kitchen (SMT-W-0041)',   description:'Flow sensor registered 0.4 L/hr at 02:45 AM. Possible pipe leak.', meter_id:'SMT-W-0041', created_at:new Date(Date.now()-7200000).toISOString(),   status:'active' },
    { id:'mock-2', severity:'warning',  type:'high_consumption', title:'High Water Consumption – Garden Zone',      description:'SMT-W-0042 exceeded daily baseline by 140%. Current: 186 L.',      meter_id:'SMT-W-0042', created_at:new Date(Date.now()-64800000).toISOString(),  status:'active' },
    { id:'mock-3', severity:'info',     type:'billing',          title:'Monthly Bill Generated – May 2026',        description:'Your bill for May 2026: LKR 4,330.00. Due: 15 Jun 2026.',          meter_id:null,         created_at:new Date(Date.now()-345600000).toISOString(), status:'active' },
  ],
  waterDays30: {
    'SMT-W-0041':[168,182,195,171,188,176,163,197,184,172,191,179,168,185,193,176,168,189,174,182,196,170,183,175,188,165,192,178,186,177],
    'SMT-W-0042':[88,96,92,84,101,89,78,95,93,87,103,91,82,97,89,94,86,99,88,92,104,87,95,90,97,83,102,91,89,94],
  },
  energyDays30:[13.2,14.8,12.9,15.1,13.7,14.4,12.8,15.6,13.9,14.2,13.5,15.0,13.1,14.7,12.6,15.3,13.8,14.5,13.0,15.2,13.4,14.9,12.7,15.4,13.6,14.3,12.5,15.5,13.3,14.1],
  pressureHours:[2.3,2.2,2.1,2.0,2.1,2.2,2.3,2.4,2.5,2.6,2.5,2.4,2.4,2.5,2.6,2.5,2.4,2.3,2.2,2.3,2.4,2.3,2.3,2.4],
};
const ALERT_ICON = { critical:'🚨', warning:'⚠️', info:'📋' };

// ── Chart Helpers ─────────────────────────────────────────────
const charts = {};
function makeLineChart(id, labels, datasets, opts = {}) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: {
      animation: { duration: 600 },
      plugins: { legend: { labels: { color:'#94a3b8', font:{size:11}, boxWidth:12 } } },
      scales: {
        x: { ticks:{color:'#4a5568',font:{size:10},maxTicksLimit:12}, grid:{color:'rgba(255,255,255,0.04)'} },
        y: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'} }
      },
      responsive: true, maintainAspectRatio: true, ...opts
    }
  });
  return charts[id];
}

function makeDoughnut(id, labels, data, colors) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor:'#0d1626', borderWidth:2, hoverOffset:6 }] },
    options: {
      cutout: '62%',
      plugins: { legend: { position:'bottom', labels: { color:'#94a3b8', font:{size:11}, boxWidth:10, padding:10 } } },
      responsive: true, maintainAspectRatio: false
    }
  });
}

function makeSparkline(id, data, color) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_,i) => i),
      datasets: [{ data, borderColor: color, borderWidth: 1.5, pointRadius: 0, fill: true,
        backgroundColor: ctx2 => {
          const gr = ctx2.chart.ctx.createLinearGradient(0,0,0,36);
          gr.addColorStop(0, color + '55'); gr.addColorStop(1, color + '00');
          return gr;
        }
      }]
    },
    options: {
      animation: false,
      plugins: { legend:{display:false}, tooltip:{enabled:false} },
      scales: { x:{display:false}, y:{display:false} },
      responsive: true, maintainAspectRatio: false
    }
  });
}

function makeBarChart(id, labels, data, colors, opts = {}) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: Array.isArray(colors) ? colors.map(c => c + '33') : colors + '33',
        borderColor: colors, borderWidth: 2, borderRadius: 6, borderSkipped: false
      }]
    },
    options: {
      animation: { duration: 600 },
      plugins: { legend:{display:false}, ...opts.plugins },
      scales: {
        x: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'} },
        y: { ticks:{color:'#4a5568',font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'} }
      },
      responsive: true, maintainAspectRatio: true, ...opts
    }
  });
  return charts[id];
}

function animCount(id, from, to, unit, dur, decimals = 0) {
  const el = $(id); if (!el) return;
  const step = (to - from) / 60;
  let cur = from;
  const iv = setInterval(() => {
    cur += step;
    if ((step>0&&cur>=to)||(step<0&&cur<=to)) { cur=to; clearInterval(iv); }
    el.innerHTML = cur.toFixed(decimals) + ' <small>' + unit + '</small>';
  }, dur / 60);
}

// ── Nav active link helper ────────────────────────────────────
function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
}

// ── Sidebar toggle ────────────────────────────────────────────
function toggleSidebar() { $('sidebar')?.classList.toggle('open'); }

// ── Live clock ────────────────────────────────────────────────
function updateDate() {
  const el = $('live-date');
  if (el) el.textContent = new Date().toLocaleString('en-IN',
    { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(updateDate, 1000);
updateDate();

// ── Update sidebar user card ──────────────────────────────────
function updateUserCard(user) {
  const name     = user?.name || 'Guest';
  const role     = user?.role || 'residential';
  const initials = name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  const nameEl   = document.querySelector('.user-name');
  const roleEl   = document.querySelector('.user-role');
  const avatarEl = $('user-avatar-initials');
  const signoutBtn = $('btn-signout');
  if (nameEl)   nameEl.textContent   = name;
  if (roleEl)   roleEl.textContent   = role.charAt(0).toUpperCase() + role.slice(1);
  if (avatarEl) avatarEl.textContent = initials;
  if (signoutBtn) signoutBtn.style.display = AUTH.demo ? 'none' : 'flex';
}

// ── Login Modal ───────────────────────────────────────────────
function hideLoginModal() { $('login-overlay')?.classList.add('hidden'); }
function showLoginModal()  { $('login-overlay')?.classList.remove('hidden'); }

let _pendingCognitoUser = null;

async function handleLogin(email, password) {
  const btn = $('btn-login');
  const err = $('login-error');
  btn.textContent = 'Signing in…'; btn.disabled = true; err.textContent = '';

  if (!userPool) {
    err.textContent = 'Cognito not configured. Check config.js and try Demo Mode.';
    btn.textContent = 'Sign In'; btn.disabled = false; return;
  }

  const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username:email, Password:password });
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username:email, Pool:userPool });

  cognitoUser.authenticateUser(authDetails, {
    onSuccess: async (result) => {
      AUTH.token = result.getIdToken().getJwtToken();
      AUTH.demo  = false;
      localStorage.setItem('aqua_token', AUTH.token);
      cognitoUser.getUserAttributes((attrErr, attributes) => {
        if (!attrErr && attributes) {
          const u = {};
          attributes.forEach(a => u[a.getName()] = a.getValue());
          AUTH.user   = { name: u.name||email, role: u['custom:account_type']||'residential', id: u.sub };
          AUTH.userId = u.sub;
          localStorage.setItem('aqua_userId', AUTH.userId);
        } else {
          AUTH.user = { name: email, role: 'residential' };
        }
        btn.textContent = 'Sign In'; btn.disabled = false;
        hideLoginModal();
        updateUserCard(AUTH.user);
        if (typeof onAuthReady === 'function') onAuthReady();
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
  AUTH = { token:null, userId:null, user:null, demo:false };
  localStorage.removeItem('aqua_token');
  localStorage.removeItem('aqua_userId');
  window.location.href = 'dashboard.html';
}

function handleSetNewPassword() {
  const pw  = $('new-pw-input').value;
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
          AUTH.user   = { name:u.name||'User', role:u['custom:account_type']||'residential', id:u.sub };
          AUTH.userId = u.sub; localStorage.setItem('aqua_userId', AUTH.userId);
        } else { AUTH.user = { name:'User', role:'residential' }; }
        _pendingCognitoUser = null;
        $('new-pw-panel').style.display = 'none';
        hideLoginModal(); updateUserCard(AUTH.user);
        if (typeof onAuthReady === 'function') onAuthReady();
      });
    },
    onFailure: (e) => { $('login-error').textContent = e.message || 'Failed to set password.'; }
  });
}

function enterDemoMode() {
  AUTH = { token:null, userId:'a0000001-0000-0000-0000-000000000001', user:{ name:'Rajesh Kumar', role:'residential' }, demo:true };
  localStorage.removeItem('aqua_token');
  localStorage.removeItem('aqua_userId');
  hideLoginModal();
  showDemoNotice();
  updateUserCard(AUTH.user);
  if (typeof onAuthReady === 'function') onAuthReady();
}

// ── Forgot / SignUp helpers ───────────────────────────────────
function toggleForgotPw(show) {
  $('login-form').style.display = show ? 'none' : 'block';
  $('forgot-pw-panel').style.display = show ? 'block' : 'none';
  $('login-title').textContent = show ? 'Reset Password' : 'Welcome back';
}
function handleForgotPwSend() {
  const email = $('forgot-email').value.trim();
  if (!email) return alert('Enter email');
  const cu = new AmazonCognitoIdentity.CognitoUser({ Username:email, Pool:userPool });
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
  const cu = new AmazonCognitoIdentity.CognitoUser({ Username:email, Pool:userPool });
  cu.confirmPassword(code, newPw, {
    onSuccess: () => { alert('Password reset! You can now sign in.'); toggleForgotPw(false); },
    onFailure: (e) => alert(e.message)
  });
}

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
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name:'name', Value:name }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name:'custom:meter_id', Value:meter||'pending' }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name:'custom:account_type', Value:'residential' })
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
  const cu = new AmazonCognitoIdentity.CognitoUser({ Username:email, Pool:userPool });
  cu.confirmRegistration(code, true, (err) => {
    if (err) { $('login-error').textContent = err.message; return; }
    alert('✅ Account verified! You can now sign in.');
    toggleSignUp(false); $('verify-panel').style.display = 'none';
  });
}

// ── Check existing session ────────────────────────────────────
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
        AUTH.user   = { name:u.name, role:u['custom:account_type']||'residential', id:u.sub };
        AUTH.userId = u.sub;
        localStorage.setItem('aqua_userId', AUTH.userId);
        updateUserCard(AUTH.user);
        resolve(true);
      });
    });
  });
}

// ── Page Bootstrap (called at bottom of each page's JS) ───────
async function bootstrapPage(pageId, initFn) {
  // Wire login form
  $('login-form')?.addEventListener('submit', e => { e.preventDefault(); handleLogin($('login-email').value, $('login-password').value); });
  $('btn-demo')?.addEventListener('click', enterDemoMode);
  $('btn-forgot-password')?.addEventListener('click', () => toggleForgotPw(true));
  $('btn-send-code')?.addEventListener('click', handleForgotPwSend);
  $('btn-confirm-reset')?.addEventListener('click', handleForgotPwConfirm);
  $('btn-set-password')?.addEventListener('click', handleSetNewPassword);
  $('link-show-signup')?.addEventListener('click', () => toggleSignUp(true));
  $('link-show-login')?.addEventListener('click',  () => toggleSignUp(false));
  $('signup-form')?.addEventListener('submit', handleSignUp);
  $('btn-verify-submit')?.addEventListener('click', handleVerifyCode);
  $('btn-signout')?.addEventListener('click', handleSignOut);

  // Mark active nav
  setActiveNav(pageId);

  // Try existing auth first
  const authed = await checkExistingAuth();
  if (!authed) {
    showLoginModal();
    // onAuthReady will be called by enterDemoMode or successful login
    window.onAuthReady = initFn;
  } else {
    hideLoginModal();
    initFn();
  }
}
