'use strict';

// Same-origin by default (backend serves the panel). For a split deploy (panel on Vercel, API on
// Render), set window.MEDINITY_API = 'https://your-backend.onrender.com' in index.html.
const API_BASE = (window.MEDINITY_API || '').replace(/\/$/, '');

const S = {
  token: localStorage.getItem('mc_token') || null,
  user: JSON.parse(localStorage.getItem('mc_user') || 'null'),
  view: 'dashboard',
  filters: { status: '', type: '' },
};
const app = () => document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && S.token) return logout();
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
  S.token = null;
  S.user = null;
  localStorage.removeItem('mc_token');
  localStorage.removeItem('mc_user');
  renderLogin();
}

// ---------------- login ----------------
function renderLogin(err = '') {
  app().innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm">
        <div class="brand"><div class="mark">M</div><div><b>Medinity Connect</b><span>Staff admin panel</span></div></div>
        <label>Email</label>
        <input id="login" type="text" autocomplete="username" value="admin@medinity.local" />
        <label>Password</label>
        <input id="password" type="password" autocomplete="current-password" value="" />
        <div class="error">${esc(err)}</div>
        <button class="btn full" type="submit">Sign in</button>
        <div class="hint">Pilot logins &mdash; admin@medinity.local / medinity@123 (super admin) &middot; housekeeping@medinity.local / house@123 (team lead).</div>
      </form>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const out = await api('/api/login', { method: 'POST', body: { login: document.getElementById('login').value, password: document.getElementById('password').value } });
      S.token = out.token;
      S.user = out.user;
      localStorage.setItem('mc_token', out.token);
      localStorage.setItem('mc_user', JSON.stringify(out.user));
      renderShell();
    } catch (ex) {
      renderLogin(ex.message);
    }
  });
}

// ---------------- shell ----------------
function renderShell() {
  const tabs = [
    ['dashboard', 'Dashboard'],
    ['tickets', 'Tickets'],
    ['bookings', 'Bookings'],
  ];
  app().innerHTML = `
    <div class="topbar">
      <div class="brand"><div class="mark">M</div><b>Medinity Connect</b></div>
      <div class="who"><span>${esc(S.user.name)} &middot; ${esc(roleLabel(S.user.role))}</span><button class="btn ghost sm" id="logout">Logout</button></div>
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${S.view === k ? 'active' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="main" id="main"></div>`;
  document.getElementById('logout').addEventListener('click', logout);
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.v; renderShell(); }));
  ({ dashboard: viewDashboard, tickets: viewTickets, bookings: viewBookings }[S.view])();
}

const roleLabel = (r) => ({ super_admin: 'Super Admin', team_lead: 'Team Lead', agent: 'Agent' }[r] || r);
const main = () => document.getElementById('main');

// ---------------- dashboard ----------------
async function viewDashboard() {
  main().innerHTML = `<div class="empty">Loading&hellip;</div>`;
  const m = await api('/api/metrics');
  const cards = [
    ['Leads', m.leads],
    ['Open tickets', m.openTickets],
    ['Resolved', m.resolved],
    ['Pending bookings', m.pendingBookings],
    ['SLA breaches', m.slaBreaches, m.slaBreaches > 0],
    ['Support handoffs', m.supportHandoffs],
    ['Avg rating', m.avgRating == null ? '·' : m.avgRating],
    ['Avg resolution (min)', m.avgResolutionMin == null ? '·' : m.avgResolutionMin],
  ];
  main().innerHTML = `
    <div class="grid">
      ${cards.map(([l, n, warn]) => `<div class="metric ${warn ? 'warn' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}
    </div>
    <div class="section-title">By team</div>
    <div class="panel table-scroll">
      <table>
        <thead><tr><th>Team</th><th>Total</th><th>Open</th><th>Resolved</th></tr></thead>
        <tbody>${m.byTeam.map((t) => `<tr><td>${esc(t.team)}</td><td>${t.total}</td><td>${t.open}</td><td>${t.resolved}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}

// ---------------- tickets ----------------
async function viewTickets() {
  main().innerHTML = `
    <div class="filters">
      <select id="fStatus">
        <option value="">All statuses</option>
        ${['new', 'assigned', 'in_progress', 'resolved', 'closed'].map((s) => `<option ${S.filters.status === s ? 'selected' : ''} value="${s}">${label(s)}</option>`).join('')}
      </select>
      <select id="fType">
        <option value="">All types</option>
        ${['complaint', 'enquiry', 'support'].map((s) => `<option ${S.filters.type === s ? 'selected' : ''} value="${s}">${label(s)}</option>`).join('')}
      </select>
    </div>
    <div class="panel table-scroll" id="ticketsPanel"><div class="empty">Loading&hellip;</div></div>`;
  document.getElementById('fStatus').addEventListener('change', (e) => { S.filters.status = e.target.value; loadTickets(); });
  document.getElementById('fType').addEventListener('change', (e) => { S.filters.type = e.target.value; loadTickets(); });
  loadTickets();
}

async function loadTickets() {
  const q = new URLSearchParams();
  if (S.filters.status) q.set('status', S.filters.status);
  if (S.filters.type) q.set('type', S.filters.type);
  const cases = await api('/api/cases?' + q.toString());
  const panel = document.getElementById('ticketsPanel');
  if (!cases.length) return (panel.innerHTML = `<div class="empty">No tickets match.</div>`);
  panel.innerHTML = `
    <table>
      <thead><tr><th>Ticket</th><th>Type</th><th>Category</th><th>Patient</th><th>Room</th><th>Team</th><th>Status</th></tr></thead>
      <tbody>
        ${cases.map((c) => `
          <tr class="click" data-id="${c.id}">
            <td>${esc(c.humanNo)}</td>
            <td><span class="badge b-type">${label(c.type)}</span></td>
            <td>${esc(c.categoryName)}</td>
            <td>${esc(c.patientName || '·')}</td>
            <td>${esc(c.roomBed || '·')}</td>
            <td>${esc(c.teamName)}</td>
            <td><span class="badge b-${c.status}">${label(c.status)}</span> ${c.slaBreached ? '<span class="badge b-sla">SLA</span>' : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  panel.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => openCase(tr.dataset.id)));
}

// ---------------- case detail ----------------
async function openCase(id) {
  const c = await api('/api/cases/' + id);
  const photo = (c.attachments || []).find((a) => a.kind === 'image');
  const evRows = (c.events || [])
    .slice()
    .reverse()
    .map((e) => `<div class="ev"><span class="t">${fmt(e.at)}</span> &middot; ${esc(e.type)}${e.payload && e.payload.status ? ' &rarr; ' + esc(e.payload.status) : ''} <span class="t">(${esc(e.actor)})</span></div>`)
    .join('');

  const canNotify = c.type !== 'support';
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal">
      <header><h3>${esc(c.humanNo)} &middot; ${esc(c.categoryName)}</h3><button class="x">&times;</button></header>
      <div class="body">
        <div class="kv">
          <div class="k">Patient</div><div>${esc(c.patientName || '·')} (${esc(c.patientPhone)})</div>
          <div class="k">Type</div><div>${label(c.type)}</div>
          <div class="k">Team</div><div>${esc(c.teamName)}</div>
          <div class="k">Room / bed</div><div>${esc(c.roomBed || '·')}</div>
          <div class="k">Status</div><div><span class="badge b-${c.status}">${label(c.status)}</span> ${c.slaBreached ? '<span class="badge b-sla">SLA breached</span>' : ''}</div>
          ${c.etaMin ? `<div class="k">ETA</div><div>${c.etaMin} min</div>` : ''}
          <div class="k">Description</div><div>${esc(c.description || '·')}</div>
          ${photo ? `<div class="k">Photo</div><div>${photo.url ? `<a href="${esc(photo.url)}" target="_blank">view</a>` : 'attached (WhatsApp media id ' + esc(photo.waMediaId) + ')'}</div>` : ''}
          ${c.booking ? `<div class="k">Booking</div><div>${esc(c.booking.doctorName)}, ${esc(c.booking.slotLabel)} &middot; <span class="badge b-${c.booking.status === 'confirmed' ? 'resolved' : 'assigned'}">${esc(c.booking.status)}</span></div>` : ''}
          ${c.rating ? `<div class="k">Rating</div><div>${c.rating} / 5</div>` : ''}
        </div>
        <div class="section-title" style="margin-top:0">History</div>
        <div class="timeline">${evRows || '<div class="ev t">No history yet.</div>'}</div>
        <div class="actions">
          ${c.status !== 'resolved' && c.status !== 'closed' ? `
            <button class="btn ghost sm" data-act="assigned">Assign to me</button>
            <button class="btn ghost sm" data-act="in_progress">On the way</button>
            <button class="btn sm" data-act="resolved">Mark resolved</button>` : ''}
          ${canNotify ? `<label class="check"><input type="checkbox" id="notify" checked /> notify patient on WhatsApp</label>` : ''}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.x').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const status = b.dataset.act;
      const notify = canNotify && overlay.querySelector('#notify')?.checked;
      if (status === 'assigned') await api('/api/cases/' + id + '/assign', { method: 'POST', body: {} });
      await api('/api/cases/' + id + '/status', { method: 'POST', body: { status, notify } });
      close();
      toast(`Ticket ${c.humanNo} &rarr; ${label(status)}${notify ? ' (patient notified)' : ''}`.replace('&rarr;', '→'));
      loadTickets();
    }),
  );
}

// ---------------- bookings ----------------
async function viewBookings() {
  main().innerHTML = `<div class="panel table-scroll" id="bk"><div class="empty">Loading&hellip;</div></div>`;
  const rows = await api('/api/bookings');
  const bk = document.getElementById('bk');
  if (!rows.length) return (bk.innerHTML = `<div class="empty">No bookings yet.</div>`);
  bk.innerHTML = `
    <table>
      <thead><tr><th>Patient</th><th>Doctor</th><th>Slot</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${rows.map((b) => `
          <tr>
            <td>${esc(b.patientName || '·')}</td>
            <td>${esc(b.doctorName)}</td>
            <td>${esc(b.slotLabel)}</td>
            <td><span class="badge b-${b.status === 'confirmed' ? 'resolved' : b.status === 'cancelled' ? 'closed' : 'assigned'}">${esc(b.status)}</span></td>
            <td>${['held', 'pending'].includes(b.status) ? `<button class="btn sm" data-c="${b.id}">Confirm</button> <button class="btn ghost sm" data-x="${b.id}">Cancel</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  bk.querySelectorAll('[data-c]').forEach((btn) =>
    btn.addEventListener('click', async () => { await api('/api/bookings/' + btn.dataset.c + '/confirm', { method: 'POST', body: { notify: true } }); toast('Booking confirmed · patient notified'); viewBookings(); }),
  );
  bk.querySelectorAll('[data-x]').forEach((btn) =>
    btn.addEventListener('click', async () => { await api('/api/bookings/' + btn.dataset.x + '/cancel', { method: 'POST', body: {} }); toast('Booking cancelled'); viewBookings(); }),
  );
}

// ---------------- utils ----------------
function label(s) {
  return ({ new: 'New', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', complaint: 'Complaint', enquiry: 'Appointment', support: 'Support' }[s]) || s;
}
function fmt(ts) {
  try { return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

// ---------------- boot ----------------
if (S.token && S.user) renderShell();
else renderLogin();
