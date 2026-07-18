'use strict';

const API_BASE = (window.MEDINITY_API || '').replace(/\/$/, '');
const S = {
  token: localStorage.getItem('mc_token') || null,
  user: JSON.parse(localStorage.getItem('mc_user') || 'null'),
  view: 'dashboard',
  detail: null, // { type, id } -> full-page detail
  portal: null, // 'doctor' | 'team' role choice for non-admins
  range: localStorage.getItem('mc_range') || '30d',
  customFrom: '',
  customTo: '',
  filters: { status: '', type: '', sla: false, q: '' },
  metrics: null,
};
let pollTimer = null;
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function startPoll(fn, ms = 6000) { stopPoll(); pollTimer = setInterval(fn, ms); }
function goDetail(type, id) { S.detail = { type, id }; renderShell(); }
function backToList() { S.detail = null; renderShell(); }
const app = () => document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- icons (inline SVG, lucide-style) ---------------- */
const P = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  ticket: '<path d="M2 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="M12 2l3 6.5 7 .9-5 4.8 1.2 7L12 18l-6.4 3.2L6.8 14l-5-4.8 7-.9z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.7"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15v2a3 3 0 0 1-3 3h-2"/><rect x="2" y="14" width="4" height="6" rx="1"/><rect x="18" y="14" width="4" height="6" rx="1"/>',
  trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  check: '<path d="M22 11v1a10 10 0 1 1-5.9-9.1"/><path d="m22 4-10 10-3-3"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  steth: '<path d="M4 3v6a5 5 0 0 0 10 0V3"/><path d="M4 3H2M14 3h-2M9 19a4 4 0 0 0 8 0v-3"/><circle cx="20" cy="12" r="2"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

/* ---------------- api ---------------- */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && S.token) return logout(), Promise.reject(new Error('unauthorized'));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function logout() {
  stopPoll();
  S.token = null; S.user = null; S.metrics = null; S.detail = null;
  S.portal = null; S.portalChecked = false; S.docId = null; S.shiftChecked = false; S.view = 'dashboard';
  localStorage.removeItem('mc_token'); localStorage.removeItem('mc_user');
  renderLogin();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mc_theme', next);
  if (S.token) renderShell(); // repaint icons/charts for the new theme
}
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

/* ---------------- login ---------------- */
function renderLogin(err = '') {
  app().innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm">
        <div class="brand"><div class="mark">M</div><div><b>Medinity Connect</b><small>Staff admin panel</small></div></div>
        <label>Email</label>
        <input id="login" type="text" autocomplete="username" value="admin@medinity.local" />
        <label>Password</label>
        <input id="password" type="password" autocomplete="current-password" value="" />
        <div class="error">${esc(err)}</div>
        <button class="btn full" type="submit">Sign in</button>
        <div class="hint">Pilot logins · admin@medinity.local / medinity@123 (super admin) · housekeeping@medinity.local / house@123 (team lead).</div>
      </form>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const out = await api('/api/login', { method: 'POST', body: { login: document.getElementById('login').value, password: document.getElementById('password').value } });
      S.token = out.token; S.user = out.user;
      localStorage.setItem('mc_token', out.token);
      localStorage.setItem('mc_user', JSON.stringify(out.user));
      S.metrics = null;
      renderShell();
    } catch (ex) {
      renderLogin(ex.message);
    }
  });
}

/* ---------------- shell ---------------- */
const roleLabel = (r) => ({ super_admin: 'Super Admin', hospital: 'Hospital Admin', team_lead: 'Team Lead', agent: 'Agent', doctor: 'Doctor' }[r] || r);
const isAdmin = () => S.user && (S.user.role === 'super_admin' || S.user.role === 'hospital');

const NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'grid']]],
  ['Operations', [['tickets', 'Tickets', 'ticket'], ['bookings', 'Bookings', 'calendar'], ['alerts', 'Alerts', 'bell']]],
  ['Records', [['patients', 'Patients', 'users'], ['feedback', 'Feedback', 'star']]],
  ['Setup', [['doctors', 'Doctors', 'pin'], ['staff', 'Staff', 'headset']]],
];
const VIEWS = { dashboard: viewDashboard, tickets: viewTickets, bookings: viewBookings, alerts: viewAlerts, patients: viewPatients, feedback: viewFeedback, doctors: viewDoctors, staff: viewStaff, myslots: viewMySlots, myappts: viewMyAppts };
const DOCTOR_NAV = [['My work', [['myslots', 'My availability', 'calendar'], ['myappts', 'My appointments', 'users']]]];

async function renderShell() {
  stopPoll();
  try {
    S.metrics = await api('/api/metrics?' + rangeQuery()); // also feeds nav counts
  } catch (e) { if (e.message === 'unauthorized') return; }
  const k = S.metrics?.kpis || {};
  const alertCount = (S.metrics?.alerts?.sla?.length || 0) + (S.metrics?.alerts?.support?.length || 0);
  const counts = { tickets: k.openTickets || 0, bookings: k.pendingBookings || 0, alerts: alertCount };
  // route by role: doctor -> doctor portal; everyone else -> team panel (admins also get Setup)
  if (S.user.role === 'doctor') { S.portal = 'doctor'; if (!S.docId) S.docId = S.user.doctorId; }
  else S.portal = 'team';
  const admin = isAdmin();
  const isDoc = S.portal === 'doctor';
  const navSrc = isDoc ? DOCTOR_NAV : (admin ? NAV : NAV.filter(([g]) => g !== 'Setup'));
  if (isDoc && !['myslots', 'myappts'].includes(S.view)) S.view = 'myslots';
  if (!admin && !isDoc && ['doctors', 'staff'].includes(S.view)) S.view = 'dashboard';
  app().innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark">M</div><div><b>Medinity</b><small>${isDoc ? 'Doctor portal' : 'Connect · Admin'}</small></div></div>
        <nav class="nav">
          ${navSrc.map(([group, items]) => `
            <div class="nav-group">${group}</div>
            ${items.map(([v, l, ic]) => `<button data-v="${v}" class="${S.view === v ? 'active' : ''}">${icon(ic)} <span>${l}</span>${counts[v] ? `<span class="count ${v === 'alerts' ? 'hot' : ''}">${counts[v]}</span>` : ''}</button>`).join('')}`).join('')}
        </nav>
        <div class="side-foot">
          <div class="who"><b>${esc(S.user.name)}</b>${esc(roleLabel(S.user.role))}</div>
          <button id="themeBtn">${icon(isDark() ? 'sun' : 'moon')} <span>${isDark() ? 'Light mode' : 'Dark mode'}</span></button>
          <button id="logoutBtn">${icon('logout')} <span>Logout</span></button>
          <div class="side-footer">Medinity · Nextgrow © 2026</div>
        </div>
      </aside>
      <main class="content"><div id="page"></div></main>
    </div>`;
  document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.v; S.detail = null; renderShell(); }));
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  if (S.detail) renderDetail();
  else (VIEWS[S.view] || viewDashboard)();
  maybeCheckin();
}

async function maybeChooser() {
  if (S.portalChecked || S.portal) return;
  S.portalChecked = true;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" style="max-width:460px"><header><h3>Welcome, ${esc(S.user.name)}</h3></header><div class="body">
    <div style="color:var(--muted);margin-bottom:4px">How will you use Medinity Connect?</div>
    <div class="chooser">
      <button data-c="doctor">${icon('steth')}<b>Doctor</b><span>Manage my slot availability</span></button>
      <button data-c="team">${icon('headset')}<b>Team member</b><span>Work tickets & bookings</span></button>
    </div></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.c;
    localStorage.setItem('mc_portal_' + S.user.id, c);
    S.portal = c;
    overlay.remove();
    if (c === 'doctor') pickDoctor();
    else { S.view = 'dashboard'; renderShell(); }
  }));
}
async function pickDoctor() {
  const docs = await api('/api/doctors');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" style="max-width:400px"><header><h3>Which doctor are you?</h3></header><div class="body">
    <select id="whichDoc">${docs.map((d) => `<option value="${d.id}">${esc(d.name)} · ${esc(d.department)}</option>`).join('')}</select>
    <button class="btn full" id="pickGo">Continue</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#pickGo').addEventListener('click', () => {
    const id = overlay.querySelector('#whichDoc').value;
    localStorage.setItem('mc_docid_' + S.user.id, id);
    S.docId = id;
    overlay.remove();
    S.view = 'myslots';
    renderShell();
  });
}
async function viewMySlots() {
  if (!S.docId) return pickDoctor();
  page().innerHTML = `<div class="pagehead"><div><h1>My availability</h1><div class="sub">Set the slots patients can book on WhatsApp</div></div></div>` + slotShell();
  await slotBuilder(S.docId);
}
async function viewMyAppts() {
  page().innerHTML = `<div class="pagehead"><div><h1>My appointments</h1><div class="sub">Your upcoming and past bookings</div></div></div>
    <div class="main"><div class="panel table-scroll" id="bk"><div class="empty">Loading…</div></div></div>`;
  const rows = (await api('/api/bookings')).filter((b) => b.doctorId === S.docId);
  const bk = document.getElementById('bk');
  if (!rows.length) return (bk.innerHTML = `<div class="empty">No appointments yet.</div>`);
  bk.innerHTML = `<table><thead><tr><th>Patient</th><th>Slot</th><th>Status</th></tr></thead><tbody>${rows.map((b) => `<tr class="click" data-id="${esc(b.id)}"><td>${esc(b.patientName || '·')}</td><td>${esc(b.slotLabel)}</td><td><span class="badge b-${bookingBadge(b.status)}">${esc(b.status)}</span></td></tr>`).join('')}</tbody></table>`;
  bk.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => goDetail('booking', tr.dataset.id)));
}

function renderDetail() {
  const { type, id } = S.detail;
  ({ ticket: ticketDetail, booking: bookingDetail, patient: patientDetail, doctor: doctorDetail, staff: staffDetail }[type] || (() => backToList()))(id);
}
function detailHead(title, live) {
  return `<div class="pagehead"><div><button class="back" id="backBtn">${icon('back', 'sm')} Back</button><h1>${title}</h1></div>${live ? `<span class="live-dot"><i></i> live</span>` : ''}</div>`;
}
function wireBack() {
  const b = document.getElementById('backBtn');
  if (b) b.addEventListener('click', backToList);
}
const page = () => document.getElementById('page');

// ---- staff daily check-in (first login of the IST day) ----
async function maybeCheckin() {
  if (S.shiftChecked) return;
  S.shiftChecked = true;
  let info;
  try { info = await api('/api/me/shift'); } catch (e) { return; }
  if (!info.needsCheckin) return;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <header><h3>Start your shift · ${esc(info.date)}</h3></header>
      <div class="body">
        <div class="sub" style="color:var(--muted);margin-bottom:14px">Confirm today's working hours and your weekly off. We use these to route and track your tickets.</div>
        <label>Shift start</label><input type="time" id="ciStart" value="09:00" />
        <label>Shift end</label><input type="time" id="ciEnd" value="18:00" />
        <label>Weekly off day</label>
        <select id="ciLeave">${days.map((d) => `<option value="${d}">${d}</option>`).join('')}</select>
        <button class="btn full" id="ciSave">Start shift</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#ciSave').addEventListener('click', async () => {
    await api('/api/me/shift', { method: 'POST', body: { startTime: overlay.querySelector('#ciStart').value, endTime: overlay.querySelector('#ciEnd').value, weeklyLeaveDay: overlay.querySelector('#ciLeave').value } });
    overlay.remove();
    toast('Shift started · have a great day');
  });
}

/* ---------------- date range ---------------- */
const RANGES = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' };
function rangeQuery() {
  if (S.range === 'all') return '';
  if (S.range === 'custom') {
    if (!S.customFrom || !S.customTo) return '';
    const from = new Date(S.customFrom).getTime();
    const to = new Date(S.customTo).getTime() + 86399000; // include the whole end day
    return `from=${from}&to=${to}`;
  }
  const days = { '7d': 7, '30d': 30, '90d': 90 }[S.range] || 30;
  const to = Date.now();
  const from = to - days * 86400000;
  return `from=${from}&to=${to}`;
}

/* ---------------- dashboard ---------------- */
function viewDashboard() {
  const m = S.metrics;
  const k = m?.kpis || {};
  const stat = (n, l, cls, nav) => `<div class="stat ${cls || ''} ${nav ? 'click' : ''}" ${nav ? `data-goto='${esc(JSON.stringify(nav))}'` : ''}><div class="n">${n ?? 0}</div><div class="l">${l}</div></div>`;
  const groups = [
    ['Tickets', 'ticket', [
      stat(k.openTickets, 'Open', '', { view: 'tickets', type: 'complaint' }),
      stat(k.resolved, 'Resolved', '', { view: 'tickets', status: 'resolved' }),
      stat(k.slaBreaches, 'SLA breaches', k.slaBreaches ? 'alert' : '', { view: 'tickets', sla: true }),
      stat(k.supportHandoffs, 'Support', '', { view: 'tickets', type: 'support' }),
    ]],
    ['Appointments', 'calendar', [
      stat(k.leads, 'Leads', '', { view: 'tickets', type: 'enquiry' }),
      stat(k.pendingBookings, 'Pending', k.pendingBookings ? 'warn' : '', { view: 'bookings' }),
    ]],
    ['Service quality', 'star', [
      stat(k.avgRating == null ? '·' : k.avgRating + ' /10', 'Avg rating', '', { view: 'feedback' }),
      stat(k.avgResolutionMin == null ? '·' : k.avgResolutionMin + 'm', 'Avg resolution', ''),
    ]],
  ];
  const rangeLabel = S.range === 'custom' ? (S.customFrom && S.customTo ? `${S.customFrom} to ${S.customTo}` : 'Custom range') : RANGES[S.range];
  page().innerHTML = `
    <div class="pagehead">
      <div><h1>Dashboard</h1><div class="sub">${esc(rangeLabel)} · live from WhatsApp</div></div>
      <div class="rangebar">
        ${['7d', '30d', '90d', 'all'].map((r) => `<button data-r="${r}" class="${S.range === r ? 'active' : ''}">${RANGES[r].replace('Last ', '')}</button>`).join('')}
        <button data-r="custom" class="${S.range === 'custom' ? 'active' : ''}">Custom</button>
        ${S.range === 'custom' ? `<input type="date" class="date" id="cFrom" value="${S.customFrom}" /><input type="date" class="date" id="cTo" value="${S.customTo}" /><button class="btn sm" id="cApply">Apply</button>` : ''}
      </div>
    </div>
    <div class="main">
      <div class="kpi-groups">
        ${groups.map(([title, ic, stats]) => `<div class="kpi-group"><h4>${icon(ic, 'sm')} ${title}</h4><div class="stat-row">${stats.join('')}</div></div>`).join('')}
      </div>
      ${alertsPanel(m?.alerts)}
      <div class="grid2">
        <div class="panel"><h3>${icon('trend')} Ticket volume</h3><div class="body">${lineChart(m?.daily || [])}</div></div>
        <div class="panel"><h3>${icon('pie')} Status mix</h3><div class="body">${donut(m?.statusCounts || {})}</div></div>
      </div>
      <div class="grid2 even">
        <div class="panel"><h3>${icon('trend')} Patient funnel</h3><div class="body">${funnelChart(m?.funnel)}</div></div>
        <div class="panel"><h3>${icon('chart')} By team</h3><div class="body">${teamBars(m?.byTeam || [])}</div></div>
      </div>
    </div>`;
  page().querySelectorAll('.rangebar button[data-r]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = b.dataset.r;
      localStorage.setItem('mc_range', r);
      if (r === 'custom') { S.range = 'custom'; return viewDashboard(); }
      S.range = r;
      S.metrics = await api('/api/metrics?' + rangeQuery());
      renderShell();
    }),
  );
  const applyBtn = page().querySelector('#cApply');
  if (applyBtn) applyBtn.addEventListener('click', async () => {
    S.customFrom = page().querySelector('#cFrom').value;
    S.customTo = page().querySelector('#cTo').value;
    if (!S.customFrom || !S.customTo) return;
    S.metrics = await api('/api/metrics?' + rangeQuery());
    renderShell();
  });
  page().querySelectorAll('.stat.click').forEach((el) =>
    el.addEventListener('click', () => {
      const nav = JSON.parse(el.dataset.goto);
      S.view = nav.view;
      if (nav.view === 'tickets') S.filters = { status: nav.status || '', type: nav.type || '', sla: !!nav.sla, q: '' };
      renderShell();
    }),
  );
  wireAlerts();
}

function funnelChart(f) {
  if (!f) return `<div class="empty">No data.</div>`;
  const stages = [
    ['Leads', f.leads, 'var(--c-blue)'],
    ['Booked', f.booked, 'var(--c-teal)'],
    ['Visited', f.visited, 'var(--c-green)'],
    ['Revisit', f.revisit, 'var(--c-indigo)'],
  ];
  const max = Math.max(1, ...stages.map(([, v]) => v));
  return `<div class="funnel">${stages.map(([name, val, col], i) => {
    const w = Math.max(4, (val / max) * 100);
    const prev = i ? stages[i - 1][1] : null;
    const conv = prev ? Math.round((val / (prev || 1)) * 100) + '%' : '';
    return `<div class="funnel-row"><div class="name">${name}</div><div class="funnel-track"><div class="funnel-fill" style="width:${w}%;background:${col}">${val}</div></div><div class="conv">${conv}</div></div>`;
  }).join('')}</div>`;
}

function alertsPanel(a) {
  if (!a) return '';
  const total = a.sla.length + a.bookings.length + a.support.length;
  if (!total) return `<div class="panel" style="margin-bottom:16px"><h3>${icon('bell')} Alerts</h3><div class="body"><div class="alert-empty">${icon('check', 'sm')} All clear · no open alerts.</div></div></div>`;
  const col = (title, ic, color, items) => `
    <div class="alert-col">
      <h4>${icon(ic, 'sm')} ${title} <span style="color:var(--muted)">(${items.length})</span></h4>
      ${items.length ? items.map((it) => it).join('') : `<div class="alert-empty">None</div>`}
    </div>`;
  const slaItems = a.sla.map((x) => `<div class="alert-item" data-open="${esc(x.id)}" style="--al:var(--c-red)"><div><div class="t">${esc(x.humanNo)} · ${esc(x.team)}</div><div class="s">Room ${esc(x.roomBed)} · overdue ${x.overdueMin}m</div></div>${icon('alert', 'sm')}</div>`);
  const bkItems = a.bookings.map((x) => `<div class="alert-item" data-bookings="1" style="--al:var(--c-amber)"><div><div class="t">${esc(x.patientName)}</div><div class="s">${esc(x.doctor)} · ${esc(x.slot)}</div></div>${icon('calendar', 'sm')}</div>`);
  const spItems = a.support.map((x) => `<div class="alert-item" data-open="${esc(x.id)}" style="--al:var(--c-teal)"><div><div class="t">${esc(x.humanNo)}</div><div class="s">${esc(x.waPhone)}</div></div>${icon('headset', 'sm')}</div>`);
  return `<div class="panel" style="margin-bottom:16px"><h3>${icon('bell')} Alerts · needs attention</h3><div class="body"><div class="alerts">
    ${col('SLA breaches', 'alert', 'red', slaItems)}
    ${col('Pending bookings', 'calendar', 'amber', bkItems)}
    ${col('Support handoffs', 'headset', 'teal', spItems)}
  </div></div></div>`;
}
function wireAlerts() {
  page().querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => goDetail('ticket', el.dataset.open)));
  page().querySelectorAll('[data-bookings]').forEach((el) => el.addEventListener('click', () => { S.view = 'bookings'; renderShell(); }));
}

/* ---------------- charts (inline SVG) ---------------- */
function lineChart(daily) {
  if (!daily.length) return `<div class="empty">No tickets in this period.</div>`;
  const W = 560, H = 190, pl = 6, pr = 6, pt = 12, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
  const n = daily.length;
  const max = Math.max(1, ...daily.flatMap((d) => [d.created, d.resolved]));
  const x = (i) => (n <= 1 ? pl + iw / 2 : pl + (i / (n - 1)) * iw);
  const y = (v) => pt + ih - (v / max) * ih;
  const path = (key) => daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  const area = `M${x(0)} ${pt + ih} ${daily.map((d, i) => `L${x(i).toFixed(1)} ${y(d.created).toFixed(1)}`).join(' ')} L${x(n - 1)} ${pt + ih} Z`;
  const grid = [0, 0.5, 1].map((f) => `<line class="chart-grid" x1="${pl}" x2="${W - pr}" y1="${pt + ih - f * ih}" y2="${pt + ih - f * ih}"/><text class="axis-label" x="${pl}" y="${pt + ih - f * ih - 3}">${Math.round(f * max)}</text>`).join('');
  const xl = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => `<text class="axis-label" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${daily[i].date.slice(5)}</text>`).join('');
  const dots = (key, col) => daily.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.5" style="fill:${col}"/>`).join('');
  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Ticket volume">
      ${grid}
      <path d="${area}" style="fill:var(--brand);opacity:.10"/>
      <path d="${path('created')}" style="fill:none;stroke:var(--brand);stroke-width:2.2"/>
      <path d="${path('resolved')}" style="fill:none;stroke:var(--c-green);stroke-width:2.2"/>
      ${dots('created', 'var(--brand)')}${dots('resolved', 'var(--c-green)')}
      ${xl}
    </svg>
    <div class="legend"><span><i style="background:var(--brand)"></i>Created</span><span><i style="background:var(--c-green)"></i>Resolved</span></div>`;
}

const STATUS_COL = { new: 'var(--c-blue)', assigned: 'var(--c-amber)', in_progress: 'var(--c-indigo)', resolved: 'var(--c-green)', closed: 'var(--c-slate)' };
function donut(sc) {
  const entries = Object.entries(sc).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) return `<div class="empty">No tickets in this period.</div>`;
  const r = 46, C = 2 * Math.PI * r;
  let off = 0;
  const segs = entries.map(([k, v]) => {
    const len = (v / total) * C;
    const s = `<circle cx="60" cy="60" r="${r}" fill="none" stroke-width="16" style="stroke:${STATUS_COL[k]}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += len;
    return s;
  }).join('');
  const legend = entries.map(([k, v]) => `<span><i style="background:${STATUS_COL[k]}"></i>${label(k)} · ${v}</span>`).join('');
  return `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <svg viewBox="0 0 120 120" style="width:132px;height:132px;flex:none" role="img" aria-label="Status mix">
        <g transform="rotate(-90 60 60)"><circle cx="60" cy="60" r="${r}" fill="none" stroke-width="16" style="stroke:var(--surface-2)"/>${segs}</g>
        <text x="60" y="57" text-anchor="middle" style="fill:var(--ink);font-size:22px;font-weight:800">${total}</text>
        <text x="60" y="74" text-anchor="middle" style="fill:var(--muted);font-size:10px">tickets</text>
      </svg>
      <div class="legend" style="flex-direction:column;gap:7px;margin:0">${legend}</div>
    </div>`;
}

function teamBars(rows) {
  const data = rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  if (!data.length) return `<div class="empty">No tickets in this period.</div>`;
  const max = Math.max(1, ...data.map((r) => r.total));
  return `<div class="bars">${data.map((r) => {
    const other = Math.max(0, r.total - r.open - r.resolved);
    const w = (v) => ((v / max) * 100).toFixed(1) + '%';
    return `<div class="bar-row"><div class="name" title="${esc(r.team)}">${esc(r.team)}</div>
      <div class="bar-track"><div class="bar-seg" style="width:${w(r.resolved)};background:var(--c-green)"></div><div class="bar-seg" style="width:${w(r.open)};background:var(--c-amber)"></div><div class="bar-seg" style="width:${w(other)};background:var(--c-slate)"></div></div>
      <div class="val">${r.total}</div></div>`;
  }).join('')}</div>
  <div class="legend"><span><i style="background:var(--c-amber)"></i>Open</span><span><i style="background:var(--c-green)"></i>Resolved</span><span><i style="background:var(--c-slate)"></i>Other</span></div>`;
}

/* ---------------- tickets (kanban) ---------------- */
const KCOLS = [['new', 'New'], ['assigned', 'Assigned'], ['in_progress', 'In progress'], ['resolved', 'Resolved']];
async function viewTickets() {
  page().innerHTML = `
    <div class="pagehead">
      <div><h1>Tickets</h1><div class="sub">Drag a card between columns to change its status</div></div>
      <button class="btn ghost sm" id="exportBtn">${icon('download', 'sm')} Export CSV</button>
    </div>
    <div class="main">
      <div class="filters">
        <div class="searchbox">${icon('search', 'sm')}<input id="fq" placeholder="Search tickets..." value="${esc(S.filters.q || '')}" autocomplete="off" /></div>
        <select id="fType"><option value="">All types</option>${['complaint', 'enquiry', 'support'].map((s) => `<option ${S.filters.type === s ? 'selected' : ''} value="${s}">${label(s)}</option>`).join('')}</select>
        ${S.filters.sla ? `<button class="btn ghost sm" id="clearSla"><span class="badge b-sla">SLA only</span> ✕</button>` : ''}
      </div>
      <div id="board"><div class="empty">Loading…</div></div>
    </div>`;
  document.getElementById('fType').addEventListener('change', (e) => { S.filters.type = e.target.value; loadBoard(); });
  document.getElementById('fq').addEventListener('input', (e) => { S.filters.q = e.target.value; loadBoard(); });
  const cs = document.getElementById('clearSla');
  if (cs) cs.addEventListener('click', () => { S.filters.sla = false; viewTickets(); });
  document.getElementById('exportBtn').addEventListener('click', exportCsv);
  loadBoard();
}
async function loadBoard() {
  const q = new URLSearchParams();
  if (S.filters.type) q.set('type', S.filters.type);
  let cases = await api('/api/cases?' + q.toString());
  if (S.filters.sla) cases = cases.filter((c) => c.slaBreached);
  if (S.filters.q) {
    const qq = S.filters.q.toLowerCase();
    cases = cases.filter((c) => [c.humanNo, c.patientName, c.description, c.categoryName, c.roomBed, c.teamName].some((v) => String(v || '').toLowerCase().includes(qq)));
  }
  const board = document.getElementById('board');
  const card = (c) => `<div class="kcard" draggable="true" data-id="${esc(c.id)}" style="--accent:${STATUS_COL[c.status] || 'var(--brand)'}">
      <div class="mt"><span class="no">${esc(c.humanNo)}</span><span class="badge b-type" style="margin-left:auto">${label(c.type)}</span></div>
      <div class="ct">${esc(catName(c.categoryName))}</div>
      <div class="mt"><span>${icon('users', 'sm')} ${esc(c.patientName || '·')}</span>${c.roomBed ? `<span>${icon('pin', 'sm')} ${esc(c.roomBed)}</span>` : ''}</div>
      <div class="mt" style="margin-top:6px">${c.slaBreached ? '<span class="badge b-sla">SLA</span> ' : ''}<span>${timeAgo(c.createdAt)}</span></div>
    </div>`;
  board.className = 'kanban';
  board.innerHTML = KCOLS.map(([st, lbl]) => {
    const items = cases.filter((c) => c.status === st);
    return `<div class="kcol" data-col="${st}"><h4>${lbl} <span>${items.length}</span></h4>${items.map(card).join('') || '<div class="ev t" style="padding:4px 6px">·</div>'}</div>`;
  }).join('');
  board.querySelectorAll('.kcard').forEach((el) => {
    el.addEventListener('click', () => goDetail('ticket', el.dataset.id));
    el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); e.dataTransfer.setData('text/plain', el.dataset.id); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  board.querySelectorAll('.kcol').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      const status = col.dataset.col;
      const c = cases.find((x) => x.id === id);
      if (!c || c.status === status) return;
      await api('/api/cases/' + id + '/status', { method: 'POST', body: { status, notify: status === 'resolved' } });
      toast(`${c.humanNo} → ${label(status)}`);
      loadBoard();
    });
  });
}

/* ---------------- ticket detail (full page, live-polling chat + status) ---------------- */
async function ticketDetail(id, poll = false) {
  let c;
  try { c = await api('/api/cases/' + id); } catch (e) { return backToList(); }
  const sig = (c.messages?.length || 0) + '|' + c.status + '|' + (c.events?.length || 0) + '|' + (c.rating || '');
  if (poll) {
    const r = document.getElementById('reply');
    if ((r && r.value) || (S.detail && S.detail._sig === sig)) return;
  }
  if (S.detail) S.detail._sig = sig;
  const photo = (c.attachments || []).find((a) => a.kind === 'image');
  const evRows = (c.events || []).slice().reverse().map((e) => `<div class="ev"><span class="t">${fmt(e.at)}</span> · ${esc(e.type)}${e.payload && e.payload.status ? ' → ' + esc(e.payload.status) : ''} <span class="t">(${esc(e.actor)})</span></div>`).join('');
  const convo = (c.messages || []).map((m) => `<div class="msg ${m.direction === 'in' ? 'in' : 'out'}">${esc(m.body)}${m.agent ? ` <span class="t">· ${esc(m.agent)}</span>` : ''}</div>`).join('');
  const canNotify = c.type !== 'support';
  const open = c.status !== 'resolved' && c.status !== 'closed';
  page().innerHTML = detailHead(esc(c.humanNo) + ' · ' + esc(catName(c.categoryName)), true) + `
    <div class="main"><div class="detail-grid">
      <div>
        <div class="panel"><h3>Details</h3><div class="body"><div class="kv" style="margin:0">
          <div class="k">Patient</div><div>${esc(c.patientName || '·')} (${esc(c.patientPhone)})</div>
          <div class="k">Type</div><div>${label(c.type)}</div>
          <div class="k">Team</div><div>${esc(c.teamName)}</div>
          <div class="k">Room / bed</div><div>${esc(c.roomBed || '·')}</div>
          <div class="k">Status</div><div><span class="badge b-${c.status}">${label(c.status)}</span> ${c.slaBreached ? '<span class="badge b-sla">SLA breached</span>' : ''}</div>
          ${c.etaMin ? `<div class="k">ETA</div><div>${c.etaMin} min</div>` : ''}
          <div class="k">Description</div><div>${esc(c.description || '·')}</div>
          ${photo && photo.url ? `<div class="k">Photo</div><div><a href="${esc(photo.url)}" target="_blank"><img class="attach" src="${esc(photo.url)}" /></a></div>` : ''}
          ${c.booking ? `<div class="k">Booking</div><div>${esc(c.booking.doctorName)}, ${esc(c.booking.slotLabel)}</div>` : ''}
          ${c.rating ? `<div class="k">Rating</div><div><b>${c.rating}</b> / 10</div>` : ''}
          <div class="k">Opened</div><div>${fmt(c.createdAt)}</div>
          ${c.resolvedAt ? `<div class="k">Resolved in</div><div>${Math.round((c.resolvedAt - c.createdAt) / 60000)} min</div>` : ''}
        </div></div></div>
        <div class="panel"><h3>${icon('clock')} History</h3><div class="body"><div class="timeline">${evRows || '<div class="ev t">No history yet.</div>'}</div></div></div>
      </div>
      <div>
        <div class="panel"><h3>${icon('phone')} Conversation</h3><div class="body">
          <div class="convo" style="max-height:340px">${convo || '<div class="ev t">No messages yet.</div>'}</div>
          <div class="reply-row"><input id="reply" placeholder="Reply to the patient..." autocomplete="off" /><button class="btn sm" id="sendReply">${icon('send', 'sm')} Send</button></div>
        </div></div>
        <div class="panel"><h3>Actions</h3><div class="body"><div class="actions" style="border:0;padding:0;margin:0">
          ${open ? `<button class="btn ghost sm" data-act="assigned">Assign to me</button><button class="btn ghost sm" data-act="in_progress">On the way</button><button class="btn sm" data-act="resolved">${icon('check', 'sm')} Resolve</button>${canNotify ? `<label class="check"><input type="checkbox" id="notify" checked /> notify patient</label>` : ''}` : '<span class="secondary">This ticket is closed.</span>'}
        </div></div></div>
      </div>
    </div></div>`;
  wireBack();
  const cv = page().querySelector('.convo'); if (cv) cv.scrollTop = cv.scrollHeight;
  page().querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const status = b.dataset.act;
    const notify = canNotify && page().querySelector('#notify')?.checked;
    if (status === 'assigned') await api('/api/cases/' + id + '/assign', { method: 'POST', body: {} });
    await api('/api/cases/' + id + '/status', { method: 'POST', body: { status, notify } });
    toast(`${c.humanNo} → ${label(status)}${notify ? ' · patient notified' : ''}`);
    ticketDetail(id);
  }));
  const sendReply = async () => { const inp = page().querySelector('#reply'); const t = (inp.value || '').trim(); if (!t) return; await api('/api/cases/' + id + '/reply', { method: 'POST', body: { body: t } }); toast('Reply sent'); ticketDetail(id); };
  page().querySelector('#sendReply').addEventListener('click', sendReply);
  page().querySelector('#reply').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReply(); });
  if (!poll) startPoll(() => ticketDetail(id, true));
}

/* ---------------- bookings ---------------- */
const bookingBadge = (s) => ({ held: 'assigned', pending: 'assigned', confirmed: 'new', visited: 'resolved', cancelled: 'closed', no_show: 'sla' }[s] || 'closed');

async function viewBookings() {
  page().innerHTML = `<div class="pagehead"><div><h1>Bookings</h1><div class="sub">Confirm, reschedule, mark visited, cancel or remind</div></div></div>
    <div class="main"><div class="panel table-scroll" id="bk"><div class="empty">Loading…</div></div></div>`;
  const rows = await api('/api/bookings');
  const bk = document.getElementById('bk');
  if (!rows.length) return (bk.innerHTML = `<div class="empty">No bookings yet.</div>`);
  bk.innerHTML = `<table><thead><tr><th>Patient</th><th>Doctor</th><th>Slot</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((b) => `<tr class="click" data-id="${esc(b.id)}">
      <td>${esc(b.patientName || '·')} ${b.isRevisit ? '<span class="badge b-type">revisit</span>' : ''}</td>
      <td>${esc(b.doctorName)}</td><td>${esc(b.slotLabel)}</td>
      <td><span class="badge b-${bookingBadge(b.status)}">${esc(b.status)}</span></td>
      <td style="text-align:right;color:var(--muted);font-size:12px">Open &rsaquo;</td>
    </tr>`).join('')}</tbody></table>`;
  bk.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => goDetail('booking', tr.dataset.id)));
}

async function bookingDetail(id) {
  const b = await api('/api/bookings/' + id);
  const evRows = (b.events || []).slice().reverse().map((e) => `<div class="ev"><span class="t">${fmt(e.at)}</span> · ${esc(e.type)} <span class="t">(${esc(e.actor)})</span></div>`).join('');
  const active = ['held', 'pending', 'confirmed'].includes(b.status);
  page().innerHTML = detailHead('Booking · ' + esc(b.doctorName)) + `
    <div class="main"><div class="detail-grid">
      <div>
        <div class="panel"><h3>Details</h3><div class="body">
          <div class="kv" style="margin:0">
            <div class="k">Patient</div><div>${esc(b.patientName || '·')} ${b.isRevisit ? '<span class="badge b-type">revisit</span>' : ''}</div>
            <div class="k">Doctor</div><div>${esc(b.doctorName)}</div>
            <div class="k">Slot</div><div>${esc(b.slotLabel)}</div>
            <div class="k">Status</div><div><span class="badge b-${bookingBadge(b.status)}">${esc(b.status)}</span></div>
            ${b.visitedAt ? `<div class="k">Visited</div><div>${fmt(b.visitedAt)}</div>` : ''}
          </div>
          ${b.pdfUrl ? `<div style="margin-top:12px"><a class="btn ghost sm" href="${b.pdfUrl}" download="appointment-confirmation.pdf">${icon('download', 'sm')} Download confirmation PDF</a></div>` : ''}
        </div></div>
        <div class="panel"><h3>${icon('clock')} Activity</h3><div class="body"><div class="timeline">${evRows || '<div class="ev t">No activity yet.</div>'}</div></div></div>
      </div>
      <div>
        <div class="panel"><h3>Actions</h3><div class="body">
          <div id="reschedRow"></div>
          <div class="actions" style="border:0;padding:0;margin:0">
            ${['held', 'pending'].includes(b.status) ? `<button class="btn sm" data-a="confirm">${icon('check', 'sm')} Confirm</button>` : ''}
            ${b.status === 'confirmed' ? `<button class="btn ghost sm" data-a="visited">Mark visited</button><button class="btn ghost sm" data-a="no_show">No-show</button>` : ''}
            ${active ? `<button class="btn ghost sm" data-a="reschedule">Reschedule</button><button class="btn ghost sm" data-a="remind">${icon('bell', 'sm')} Send reminder</button><button class="btn ghost sm" data-a="cancel">Cancel</button>` : ''}
          </div>
        </div></div>
      </div>
    </div></div>`;
  wireBack();
  const post = (act, body = {}) => api('/api/bookings/' + id + '/' + act, { method: 'POST', body });
  const refresh = () => bookingDetail(id);
  page().querySelectorAll('[data-a]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const a = btn.dataset.a;
      if (a === 'confirm') { await post('confirm', { notify: true }); toast('Confirmed · patient notified'); refresh(); }
      else if (a === 'cancel') { await post('cancel'); toast('Booking cancelled'); refresh(); }
      else if (a === 'visited') { await post('visited'); toast('Marked visited'); refresh(); }
      else if (a === 'no_show') { await post('no_show'); toast('Marked no-show'); refresh(); }
      else if (a === 'remind') { await post('remind'); toast('Reminder sent to patient'); }
      else if (a === 'reschedule') showReschedule(b, id, refresh);
    }),
  );
}

async function showReschedule(b, id, refresh) {
  const row = page().querySelector('#reschedRow');
  row.innerHTML = `<div class="section-title" style="margin-top:0">Pick a new slot</div><div id="slotOpts">Loading…</div>`;
  const slots = await api('/api/slots?doctorId=' + encodeURIComponent(b.doctorId));
  const opts = page().querySelector('#slotOpts');
  if (!slots.length) return (opts.innerHTML = `<div class="ev t">No open slots for this doctor. Add availability in the Doctors section.</div>`);
  opts.innerHTML = slots.map((s) => `<button class="btn ghost sm" data-slot="${esc(s.id)}" style="margin:0 6px 8px 0">${esc(s.label)}</button>`).join('');
  opts.querySelectorAll('[data-slot]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try { await api('/api/bookings/' + id + '/reschedule', { method: 'POST', body: { slotId: btn.dataset.slot, notify: true } }); toast('Rescheduled · patient notified'); refresh(); } catch (e) { toast(e.message); }
    }),
  );
}

async function exportCsv() {
  const res = await fetch(API_BASE + '/api/export/cases.csv', { headers: { Authorization: 'Bearer ' + S.token } });
  const text = await res.text();
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'medinity-tickets.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported CSV');
}

/* ---------------- alerts ---------------- */
function alertCol(title, items) {
  return `<div class="alert-col"><h4>${title} <span style="color:var(--muted)">(${items.length})</span></h4>${items.length ? items.join('') : `<div class="alert-empty">None</div>`}</div>`;
}
async function viewAlerts() {
  page().innerHTML = `<div class="pagehead"><div><h1>Alerts</h1><div class="sub">Items that need attention right now</div></div></div>
    <div class="main" id="alertsMain"><div class="empty">Loading…</div></div>`;
  const a = await api('/api/alerts');
  const el = document.getElementById('alertsMain');
  if (a.sla.length + a.bookings.length + a.support.length === 0) return (el.innerHTML = `<div class="panel"><div class="empty">${icon('check')} All clear · no open alerts.</div></div>`);
  el.innerHTML = `<div class="alerts">
    ${alertCol('SLA breaches', a.sla.map((x) => `<div class="alert-item" data-open="${esc(x.id)}" style="--al:var(--c-red)"><div><div class="t">${esc(x.humanNo)} · ${esc(x.team)}</div><div class="s">Room ${esc(x.roomBed)} · overdue ${x.overdueMin}m</div></div>${icon('alert', 'sm')}</div>`))}
    ${alertCol('Pending bookings', a.bookings.map((x) => `<div class="alert-item" data-bk="${esc(x.id)}" style="--al:var(--c-amber)"><div><div class="t">${esc(x.patientName)}</div><div class="s">${esc(x.doctor)} · ${esc(x.slot)}</div></div>${icon('calendar', 'sm')}</div>`))}
    ${alertCol('Support handoffs', a.support.map((x) => `<div class="alert-item" data-open="${esc(x.id)}" style="--al:var(--c-teal)"><div><div class="t">${esc(x.humanNo)}</div><div class="s">${esc(x.waPhone)}</div></div>${icon('headset', 'sm')}</div>`))}
  </div>`;
  el.querySelectorAll('[data-open]').forEach((e) => e.addEventListener('click', () => goDetail('ticket', e.dataset.open)));
  el.querySelectorAll('[data-bk]').forEach((e) => e.addEventListener('click', () => goDetail('booking', e.dataset.bk)));
}

/* ---------------- feedback ---------------- */
async function viewFeedback() {
  page().innerHTML = `<div class="pagehead"><div><h1>Feedback</h1><div class="sub">Patient ratings, 1 to 10</div></div></div>
    <div class="main" id="fbMain"><div class="empty">Loading…</div></div>`;
  const f = await api('/api/feedback');
  const maxD = Math.max(1, ...Object.values(f.distribution));
  const dist = Object.entries(f.distribution).map(([n, c]) => `<div class="b" style="height:${(c / maxD) * 100}%" title="${n}: ${c}"><span>${n}</span></div>`).join('');
  document.getElementById('fbMain').innerHTML = `
    <div class="grid2">
      <div class="panel"><h3>${icon('star')} Rating distribution</h3><div class="body">
        ${f.count ? `<div style="font-size:26px;font-weight:800">${f.avg} <span style="font-size:14px;color:var(--muted)">/ 10 avg · ${f.count} ratings</span></div><div class="dist" style="margin-top:14px">${dist}</div><div style="height:20px"></div>` : `<div class="empty">No ratings yet.</div>`}
      </div></div>
      <div class="panel"><h3>${icon('users')} Recent feedback</h3><div class="body" style="padding:0">
        ${f.items.length ? f.items.map((c) => `<div class="list-row" data-open="${esc(c.id)}" style="grid-template-columns:auto 1fr auto"><span class="badge b-resolved">${c.rating}/10</span><div><div class="primary">${esc(c.patientName || '·')}</div><div class="secondary">${esc(c.humanNo)} · ${esc(catName(c.categoryName))}</div></div><span class="secondary">${c.resolvedAt ? timeAgo(c.resolvedAt) : ''}</span></div>`).join('') : `<div class="empty">No feedback yet.</div>`}
      </div></div>
    </div>`;
  document.querySelectorAll('#fbMain [data-open]').forEach((e) => e.addEventListener('click', () => goDetail('ticket', e.dataset.open)));
}

/* ---------------- patients (log book) ---------------- */
async function viewPatients() {
  page().innerHTML = `<div class="pagehead"><div><h1>Patients</h1><div class="sub">Log book · history and notes</div></div></div>
    <div class="main"><div class="panel" id="ptMain" style="padding:0"><div class="empty">Loading…</div></div></div>`;
  const rows = await api('/api/patients');
  const el = document.getElementById('ptMain');
  if (!rows.length) return (el.innerHTML = `<div class="empty">No patients yet.</div>`);
  el.innerHTML = rows.map((p) => `<div class="list-row" data-p="${esc(p.waPhone)}" style="grid-template-columns:minmax(0,1fr) auto auto auto"><div style="min-width:0"><div class="primary">${esc(p.name)}</div><div class="secondary">${esc(p.waPhone)}</div></div><span class="pill">${p.tickets} tickets</span><span class="pill">${p.visits} visits</span><span class="secondary">${p.lastAt ? timeAgo(p.lastAt) : '·'}</span></div>`).join('');
  el.querySelectorAll('[data-p]').forEach((e) => e.addEventListener('click', () => goDetail('patient', e.dataset.p)));
}
async function patientDetail(waPhone) {
  const d = await api('/api/patients/' + encodeURIComponent(waPhone));
  const p = d.patient;
  const caseRows = d.cases.map((c) => `<div class="ev" data-open="${esc(c.id)}" style="cursor:pointer"><b>${esc(c.humanNo)}</b> · ${label(c.type)} · ${esc(catName(c.categoryName))} · <span class="badge b-${c.status}">${label(c.status)}</span> <span class="t">${fmt(c.createdAt)}</span></div>`).join('');
  const bkRows = d.bookings.map((b) => `<div class="ev">${esc(b.doctorName)} · ${esc(b.slotLabel)} · <span class="badge b-${bookingBadge(b.status)}">${esc(b.status)}</span></div>`).join('');
  const recRows = d.records.map((r) => `<div class="ev"><span class="t">${fmt(r.at)}</span> · <b>${esc(r.kind)}</b> · ${esc(r.note)} <span class="t">(${esc(r.author)})</span></div>`).join('');
  page().innerHTML = detailHead(esc(p.name || '·') + ' · ' + esc(p.waPhone)) + `
    <div class="main"><div class="detail-grid">
      <div>
        <div class="panel"><h3>Notes</h3><div class="body">
          <textarea id="ptNotes" rows="3" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);resize:vertical">${esc(p.notes || '')}</textarea>
          <div style="margin-top:8px"><button class="btn sm" id="saveNotes">Save notes</button></div>
        </div></div>
        <div class="panel"><h3>Log book · visits & hospitalisations</h3><div class="body">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><select id="recKind" style="width:auto"><option value="note">Note</option><option value="hospitalisation">Hospitalisation</option><option value="visit">Visit</option></select><input id="recNote" placeholder="Details..." style="flex:1;min-width:150px" /><button class="btn sm" id="addRec">Add</button></div>
          <div class="timeline">${recRows || '<div class="ev t">No log entries.</div>'}</div>
        </div></div>
      </div>
      <div>
        <div class="panel"><h3>${icon('ticket')} Tickets (${d.cases.length})</h3><div class="body"><div class="timeline">${caseRows || '<div class="ev t">None.</div>'}</div></div></div>
        <div class="panel"><h3>${icon('calendar')} Appointments (${d.bookings.length})</h3><div class="body"><div class="timeline">${bkRows || '<div class="ev t">None.</div>'}</div></div></div>
      </div>
    </div></div>`;
  wireBack();
  page().querySelector('#saveNotes').addEventListener('click', async () => { await api('/api/patients/' + encodeURIComponent(waPhone), { method: 'PATCH', body: { notes: page().querySelector('#ptNotes').value } }); toast('Notes saved'); });
  page().querySelector('#addRec').addEventListener('click', async () => { const note = page().querySelector('#recNote').value.trim(); if (!note) return; await api('/api/patients/' + encodeURIComponent(waPhone) + '/records', { method: 'POST', body: { kind: page().querySelector('#recKind').value, note } }); patientDetail(waPhone); toast('Log entry added'); });
  page().querySelectorAll('[data-open]').forEach((e) => e.addEventListener('click', () => goDetail('ticket', e.dataset.open)));
}

/* ---------------- doctors + slot management ---------------- */
async function viewDoctors() {
  page().innerHTML = `<div class="pagehead"><div><h1>Doctors</h1><div class="sub">Manage doctors and live slot availability</div></div><button class="btn sm" id="addDoc">${icon('users', 'sm')} Add doctor</button></div>
    <div class="main"><div class="panel" id="docMain" style="padding:0"><div class="empty">Loading…</div></div></div>`;
  document.getElementById('addDoc').addEventListener('click', addDoctor);
  const docs = await api('/api/doctors');
  const el = document.getElementById('docMain');
  if (!docs.length) return (el.innerHTML = `<div class="empty">No doctors yet. Add one to publish slots.</div>`);
  el.innerHTML = docs.map((d) => `<div class="list-row" data-d="${esc(d.id)}" style="grid-template-columns:minmax(0,1fr) auto auto auto"><div style="min-width:0"><div class="primary">${esc(d.name)} ${d.onLeave ? '<span class="pill leave">on leave</span>' : ''}</div><div class="secondary">${esc(d.department)}</div></div>${d.avgRating != null ? `<span class="pill">★ ${d.avgRating}/10</span>` : '<span class="secondary">no ratings</span>'}<span class="pill">${d.openSlots} open</span><span class="secondary">${d.totalSlots} slots</span></div>`).join('');
  el.querySelectorAll('[data-d]').forEach((e) => e.addEventListener('click', () => goDetail('doctor', e.dataset.d)));
}
async function addDoctor() {
  const name = prompt('Doctor name'); if (!name) return;
  const department = prompt('Department'); if (!department) return;
  await api('/api/doctors', { method: 'POST', body: { name, department } });
  toast('Doctor added');
  viewDoctors();
}
const slotShell = () => `
    <div class="main"><div class="detail-grid">
      <div><div class="panel"><h3>${icon('calendar')} Add availability</h3><div class="body"><div id="calWrap"></div></div></div></div>
      <div><div class="panel"><h3>Current slots · patients pick these on WhatsApp</h3><div class="body" id="slotList"><div class="empty">Loading…</div></div></div></div>
    </div></div>`;

async function doctorDetail(id) {
  const docs = await api('/api/doctors');
  const doc = docs.find((d) => d.id === id) || { name: 'Doctor', department: '' };
  page().innerHTML = detailHead(esc(doc.name) + ' · ' + esc(doc.department) + (doc.avgRating != null ? ` · ★ ${doc.avgRating}/10` : '')) + slotShell();
  wireBack();
  await slotBuilder(id);
}

async function slotBuilder(id) {
  let month = new Date();
  month.setDate(1);
  let selDate = null;
  const picked = new Set();
  let slots = [];

  const renderSlots = () => {
    const el = page().querySelector('#slotList');
    if (!el) return;
    if (!slots.length) { el.innerHTML = `<div class="ev t">No slots yet. Add availability on the calendar so patients can book real times.</div>`; return; }
    el.innerHTML = slots.map((s) => `<div class="slot-item"><div>${esc(s.label)} <span class="secondary">· cap ${s.capacity} · ${s.bookedCount} booked</span></div><div>${s.bookedCount > 0 ? '<span class="pill">booked</span>' : `<button class="btn ghost sm" data-del="${esc(s.id)}">Off</button>`}</div></div>`).join('');
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { const sl = slots.find((x) => x.id === b.dataset.del); await api('/api/slots/' + b.dataset.del, { method: 'DELETE' }); toast('Doctor off · ' + (sl ? sl.label : 'slot') + ' removed'); await loadSlots(); renderCal(); }));
  };
  const loadSlots = async () => { slots = await api('/api/doctors/' + id + '/slots'); renderSlots(); };

  const renderTimes = () => {
    const tw = page().querySelector('#timeWrap');
    if (!tw) return;
    if (!selDate) { tw.innerHTML = `<div class="secondary">Pick a date to set time slots.</div>`; return; }
    const times = [];
    for (let h = 9; h <= 18; h++) { times.push(`${String(h).padStart(2, '0')}:00`); if (h < 18) times.push(`${String(h).padStart(2, '0')}:30`); }
    const dObj = new Date(selDate + 'T00:00:00');
    const dayLabel = dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const mkLabel = (t) => `${dayLabel}, ${t}`;
    const bookedLabels = new Set(slots.filter((s) => (s.startAt || '').slice(0, 10) === selDate).map((s) => s.label));
    tw.innerHTML = `<div class="secondary" style="margin-bottom:8px">${dayLabel} · tick the times this doctor is available</div>
      <div class="timegrid">${times.map((t) => { const booked = bookedLabels.has(mkLabel(t)); return `<div class="tchip ${booked ? 'booked' : ''} ${picked.has(t) ? 'on' : ''}" data-t="${booked ? '' : t}">${t}</div>`; }).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <input id="custT" placeholder="custom e.g. 20:15" style="width:140px" /><button class="btn ghost sm" id="addCust">Add custom</button>
        <button class="btn sm" id="addTimes" style="margin-left:auto">Add ${picked.size || ''} selected</button>
      </div>`;
    tw.querySelectorAll('.tchip[data-t]').forEach((el) => { if (!el.dataset.t) return; el.addEventListener('click', () => { const t = el.dataset.t; picked.has(t) ? picked.delete(t) : picked.add(t); renderTimes(); }); });
    tw.querySelector('#addCust').addEventListener('click', () => { const t = tw.querySelector('#custT').value.trim(); if (/^\d{1,2}:\d{2}$/.test(t)) { picked.add(t); renderTimes(); } else toast('Use HH:MM, e.g. 20:15'); });
    tw.querySelector('#addTimes').addEventListener('click', async () => {
      if (!picked.size) return toast('Pick at least one time');
      for (const t of picked) await api('/api/doctors/' + id + '/slots', { method: 'POST', body: { label: mkLabel(t), startAt: selDate + 'T' + t + ':00', capacity: 1 } });
      toast(picked.size + ' slot(s) added · live on WhatsApp');
      picked.clear();
      await loadSlots();
      renderCal();
    });
  };
  const renderCal = () => {
    const wrap = page().querySelector('#calWrap');
    if (!wrap) return;
    const y = month.getFullYear(), m = month.getMonth();
    const startDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-day muted"></div>`);
    for (let d = 1; d <= days; d++) {
      const ds = new Date(y, m, d).toLocaleDateString('en-CA');
      const past = ds < todayStr;
      const has = slots.some((s) => (s.startAt || '').slice(0, 10) === ds);
      cells.push(`<div class="cal-day ${past ? 'muted' : ''} ${selDate === ds ? 'sel' : ''} ${has ? 'has' : ''}" data-d="${past ? '' : ds}">${d}</div>`);
    }
    wrap.innerHTML = `
      <div class="cal-head"><button class="cal-nav" id="pm">‹</button><span>${month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span><button class="cal-nav" id="nm">›</button></div>
      <div class="cal-dow">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div id="timeWrap" style="margin-top:16px"></div>`;
    wrap.querySelector('#pm').addEventListener('click', () => { month.setMonth(m - 1); renderCal(); });
    wrap.querySelector('#nm').addEventListener('click', () => { month.setMonth(m + 1); renderCal(); });
    wrap.querySelectorAll('.cal-day[data-d]').forEach((el) => { if (!el.dataset.d) return; el.addEventListener('click', () => { selDate = el.dataset.d; picked.clear(); renderCal(); }); });
    renderTimes();
  };

  await loadSlots();
  renderCal();
}

/* ---------------- staff (team directory) ---------------- */
async function viewStaff() {
  const admin = isAdmin();
  page().innerHTML = `<div class="pagehead"><div><h1>Staff</h1><div class="sub">Team directory · workload, hours and leave</div></div>${admin ? `<button class="btn sm" id="addStaff">${icon('users', 'sm')} Add staff</button>` : ''}</div>
    <div class="main"><div class="panel" id="stMain" style="padding:0"><div class="empty">Loading…</div></div></div>`;
  if (admin) document.getElementById('addStaff').addEventListener('click', addStaff);
  const rows = await api('/api/staff');
  document.getElementById('stMain').innerHTML = rows.map((u) => `<div class="list-row" data-s="${esc(u.id)}" style="grid-template-columns:minmax(0,1fr) auto auto auto auto"><div style="min-width:0"><div class="primary">${esc(u.name)} ${u.onLeave ? '<span class="pill leave">on leave</span>' : ''}</div><div class="secondary">${esc(u.login)} · ${esc(roleLabel(u.role))} · ${esc(u.teamName)}</div></div>${u.avgRating != null ? `<span class="pill">★ ${u.avgRating}/10</span>` : '<span></span>'}<span class="pill">${u.assigned} open</span><span class="pill">${u.resolved} done</span><span class="secondary">${esc(u.hours || '·')}</span></div>`).join('');
  document.querySelectorAll('#stMain [data-s]').forEach((e) => e.addEventListener('click', () => goDetail('staff', e.dataset.s)));
}
async function addStaff() {
  const name = prompt('Staff name'); if (!name) return;
  const login = prompt('Login email'); if (!login) return;
  const password = prompt('Temporary password (min 4 chars)'); if (!password) return;
  const cfg = await api('/api/config');
  const teamId = prompt('Team (' + cfg.teams.map((t) => t.id).join(', ') + ')', 'front_desk');
  try { await api('/api/staff', { method: 'POST', body: { name, login, password, role: 'agent', teamId } }); toast('Staff added · password: ' + password); viewStaff(); } catch (e) { toast(e.message); }
}
async function staffDetail(id) {
  const [rows, cfg] = await Promise.all([api('/api/staff'), api('/api/config')]);
  const u = rows.find((r) => r.id === id);
  if (!u) return backToList();
  const admin = isAdmin();
  page().innerHTML = detailHead(esc(u.name)) + `
    <div class="main"><div class="detail-grid">
      <div><div class="panel"><h3>Profile</h3><div class="body"><div class="kv" style="margin:0">
        <div class="k">Login</div><div>${esc(u.login)}</div>
        <div class="k">Role</div><div>${esc(roleLabel(u.role))}</div>
        <div class="k">Team</div><div>${esc(u.teamName)}</div>
        <div class="k">Hours</div><div>${esc(u.hours || '·')}</div>
        <div class="k">Status</div><div>${u.onLeave ? '<span class="pill leave">on leave</span>' : '<span class="pill">active</span>'}</div>
        <div class="k">Workload</div><div>${u.assigned} open · ${u.resolved} resolved</div>
        <div class="k">Rating</div><div>${u.avgRating != null ? `★ <b>${u.avgRating}</b> / 10` : '·'}</div>
      </div></div></div></div>
      <div>${admin ? `<div class="panel"><h3>Manage</h3><div class="body">
        <label>Team</label><select id="stTeam">${cfg.teams.map((t) => `<option value="${t.id}" ${u.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <label>Working hours</label><input id="stHours" value="${esc(u.hours || '')}" placeholder="09:00-18:00" />
        <div class="form-actions"><button class="btn sm" id="stSave">Save</button><button class="btn ghost sm" id="stLeave">${u.onLeave ? 'Mark active' : 'Mark on leave'}</button><button class="btn ghost sm" id="stPwd">Reset password</button></div>
      </div></div>` : '<div class="panel"><div class="empty">Only a super admin can manage staff.</div></div>'}</div>
    </div></div>`;
  wireBack();
  if (admin) {
    page().querySelector('#stSave').addEventListener('click', async () => { await api('/api/staff/' + id, { method: 'PATCH', body: { teamId: page().querySelector('#stTeam').value, hours: page().querySelector('#stHours').value } }); toast('Saved'); staffDetail(id); });
    page().querySelector('#stLeave').addEventListener('click', async () => { await api('/api/staff/' + id, { method: 'PATCH', body: { onLeave: !u.onLeave } }); toast(u.onLeave ? 'Marked active' : 'Marked on leave'); staffDetail(id); });
    page().querySelector('#stPwd').addEventListener('click', async () => { const pw = prompt('New password for ' + u.name + ' (min 4 chars)'); if (!pw) return; try { await api('/api/staff/' + id + '/reset-password', { method: 'POST', body: { password: pw } }); toast('Password reset to: ' + pw); } catch (e) { toast(e.message); } });
  }
}

/* ---------------- utils ---------------- */
function label(s) {
  return { new: 'New', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', complaint: 'Complaint', enquiry: 'Appointment', support: 'Support' }[s] || s;
}
function catName(s) {
  return { appointment: 'Appointment', support: 'Talk to our team' }[s] || s;
}
function fmt(ts) {
  try { return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* ---------------- boot ---------------- */
if (S.token && S.user) renderShell();
else renderLogin();
