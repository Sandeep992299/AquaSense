/* =============================================
   AquaSense – Shared Sidebar HTML snippet
   Include this as a JS helper so each page
   can inject the sidebar without copy-pasting.
   ============================================= */

/**
 * Renders the sidebar into #sidebar.
 * Call after DOM is ready.
 * @param {string} activePage  - 'dashboard' | 'live' | 'crud' | 'water' | 'energy' | 'alerts' | 'billing'
 */
function renderSidebar(activePage) {
  const pages = [
    { id:'dashboard',  href:'dashboard.html',       label:'Dashboard',       icon:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>' },
    { id:'live',       href:'live.html',            label:'Live Telemetry',  icon:'<circle cx="12" cy="12" r="3"/><path d="M5.5 5.5A10 10 0 0 0 2 12a10 10 0 0 0 3.5 7.5"/><path d="M18.5 5.5A10 10 0 0 1 22 12a10 10 0 0 1-3.5 7.5"/><path d="M8.5 8.5A6 6 0 0 0 6 12a6 6 0 0 0 2.5 4.9"/><path d="M15.5 8.5A6 6 0 0 1 18 12a6 6 0 0 1-2.5 4.9"/>', extra:'<span class="live-nav-dot"></span>' },
    { id:'crud',       href:'data-management.html', label:'Data Management', icon:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' },
    { id:'water',      href:'water.html',           label:'Water Usage',     icon:'<path d="M12 2C12 2 4 9 4 14.5C4 18.64 7.58 22 12 22C16.42 22 20 18.64 20 14.5C20 9 12 2 12 2Z"/>' },
    { id:'energy',     href:'energy.html',          label:'Energy Monitor',  icon:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
    { id:'alerts',     href:'alerts.html',          label:'Alerts',          icon:'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', extra:'<span class="badge" id="alert-badge">3</span>' },
    { id:'billing',    href:'billing.html',         label:'Billing',         icon:'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
  ];

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-icon">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M14 2C14 2 5 10 5 16.5C5 21.2 9.03 25 14 25C18.97 25 23 21.2 23 16.5C23 10 14 2 14 2Z" fill="url(#sbwg)"/>
          <defs><linearGradient id="sbwg" x1="5" y1="2" x2="23" y2="25" gradientUnits="userSpaceOnUse"><stop stop-color="#38bdf8"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>
        </svg>
      </div>
      <div class="logo-text"><span class="logo-name">AquaSense</span><span class="logo-sub">Smart Utilities</span></div>
    </div>
    <nav class="sidebar-nav">
      ${pages.map(p => `
        <a href="${p.href}" class="nav-item${p.id === activePage ? ' active' : ''}" data-page="${p.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${p.icon}</svg>
          <span>${p.label}</span>
          ${p.extra || ''}
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar" id="user-avatar-initials">RK</div>
        <div class="user-info"><span class="user-name">Rajesh Kumar</span><span class="user-role">Residential</span></div>
        <div class="online-dot"></div>
      </div>
      <button id="btn-signout" class="btn-signout" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign Out
      </button>
    </div>`;
}
