// Admin JSON API. Returns { status, json }. Auth is a Bearer token except for /api/login.
// RBAC: super_admin sees everything; other roles see only their team's cases. (async: store I/O)

import { signToken, verifyToken, verifyPassword, hashPassword } from './auth.js';
import { computeMetrics } from './metrics.js';
import { appointmentPdf } from '../services/pdf.js';
import { setStatus, isSlaBreached, isOpen } from '../services/cases.js';
import { adminSendUpdate, sendAgentMessage, notifyPatient } from '../services/messaging.js';
import { confirmBooking, cancelBooking, rescheduleBooking, markVisited, markNoShow } from '../services/booking.js';

const NOTIFY_KEY = { assigned: 'status_assigned', in_progress: 'status_on_the_way', resolved: 'status_resolved' };

export async function apiRouter(deps, { method, path, query, body, headers }) {
  const { store, adapter } = deps;
  const seg = path.split('/').filter(Boolean); // ['api', 'cases', 'case_3', 'status']

  if (path === '/api/login' && method === 'POST') {
    const u = await store.getUserByLogin(body?.login || '');
    if (!u || !u.active || !verifyPassword(body?.password || '', u.passwordHash)) {
      return { status: 401, json: { error: 'Invalid email or password' } };
    }
    return { status: 200, json: { token: signToken({ uid: u.id, role: u.role }), user: publicUser(u) } };
  }

  // --- everything below requires a valid token ---
  const token = (headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  const user = payload && (await store.getUser(payload.uid));
  if (!user || !user.active) return { status: 401, json: { error: 'unauthorized' } };

  if (path === '/api/me' && method === 'GET') return { status: 200, json: publicUser(user) };
  if (path === '/api/metrics' && method === 'GET') {
    const from = query.from ? Number(query.from) : null;
    const to = query.to ? Number(query.to) : null;
    return { status: 200, json: await computeMetrics(store, { from, to }) };
  }
  if (path === '/api/config' && method === 'GET') {
    return { status: 200, json: { teams: await store.listTeams(), categories: await store.listComplaintCategories() } };
  }

  // --- cases ---
  if (seg[1] === 'cases' && seg.length === 2 && method === 'GET') {
    let cases = await visibleCases(store, user);
    if (query.status) cases = cases.filter((c) => c.status === query.status);
    if (query.type) cases = cases.filter((c) => c.type === query.type);
    if (query.team) cases = cases.filter((c) => c.teamId === query.team);
    cases.sort((a, b) => b.createdAt - a.createdAt);
    return { status: 200, json: await Promise.all(cases.map((c) => enrich(store, c, false))) };
  }

  if (seg[1] === 'cases' && seg.length === 3 && method === 'GET') {
    const c = await store.getCase(seg[2]);
    if (!c || !canSee(user, c)) return { status: 404, json: { error: 'not found' } };
    return { status: 200, json: await enrich(store, c, true) };
  }

  if (seg[1] === 'cases' && seg[3] === 'status' && method === 'POST') {
    const c = await store.getCase(seg[2]);
    if (!c || !canSee(user, c)) return { status: 404, json: { error: 'not found' } };
    const status = body?.status;
    if (!['assigned', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return { status: 400, json: { error: 'invalid status' } };
    }
    await setStatus(store, c.id, status, user.name);
    if (body?.notify && NOTIFY_KEY[status]) {
      await adminSendUpdate(store, adapter, { caseId: c.id, key: NOTIFY_KEY[status], actor: user.name });
    }
    if (status === 'resolved' && body?.notify) await markAwaitingFeedback(store, c); // next 1-10 reply = rating
    return { status: 200, json: await enrich(store, await store.getCase(c.id), true) };
  }

  if (seg[1] === 'cases' && seg[3] === 'assign' && method === 'POST') {
    const c = await store.getCase(seg[2]);
    if (!c || !canSee(user, c)) return { status: 404, json: { error: 'not found' } };
    await store.updateCase(c.id, { assigneeId: body?.userId || user.id });
    await store.addCaseEvent(c.id, { actor: user.name, type: 'assigned', payload: { userId: body?.userId || user.id } });
    return { status: 200, json: await enrich(store, await store.getCase(c.id), true) };
  }

  if (seg[1] === 'cases' && seg[3] === 'notify' && method === 'POST') {
    const c = await store.getCase(seg[2]);
    if (!c || !canSee(user, c)) return { status: 404, json: { error: 'not found' } };
    if (!body?.key) return { status: 400, json: { error: 'key required' } };
    const message = await adminSendUpdate(store, adapter, { caseId: c.id, key: body.key, actor: user.name });
    return { status: 200, json: { sent: message } };
  }

  // Two-way inbox: free-text agent reply to the patient (24h window applies on Meta's side).
  if (seg[1] === 'cases' && seg[3] === 'reply' && method === 'POST') {
    const c = await store.getCase(seg[2]);
    if (!c || !canSee(user, c)) return { status: 404, json: { error: 'not found' } };
    const text = (body?.body || '').trim();
    if (!text) return { status: 400, json: { error: 'message body required' } };
    await sendAgentMessage(store, adapter, { waPhone: c.waPhone, body: text, actor: user.name, caseId: c.id });
    return { status: 200, json: await enrich(store, c, true) };
  }

  // --- bookings ---
  if (seg[1] === 'bookings' && seg.length === 2 && method === 'GET') {
    const list = await store.listBookings();
    return { status: 200, json: await Promise.all(list.map((b) => enrichBooking(store, b))) };
  }

  if (seg[1] === 'bookings' && seg[3] === 'confirm' && method === 'POST') {
    const b = await store.getBooking(seg[2]);
    if (!b) return { status: 404, json: { error: 'not found' } };
    await confirmBooking(store, b.id);
    if (b.caseId) {
      if (body?.notify) {
        const doctor = await store.getDoctor(b.doctorId);
        const slot = await store.getSlot(b.slotId);
        await adminSendUpdate(store, adapter, { caseId: b.caseId, key: 'booking_confirmed', actor: user.name, extraVars: { doctor: doctor?.name || '', slot: slot?.label || '' } });
      }
      await makeConfirmationPdf(store, adapter, await store.getBooking(b.id), body?.notify); // legit PDF confirmation
    }
    return { status: 200, json: await enrichBooking(store, await store.getBooking(b.id)) };
  }

  if (seg[1] === 'bookings' && seg[3] === 'cancel' && method === 'POST') {
    const b = await store.getBooking(seg[2]);
    if (!b) return { status: 404, json: { error: 'not found' } };
    await cancelBooking(store, b.id);
    if (b.caseId) await store.addCaseEvent(b.caseId, { actor: user.name, type: 'cancelled', payload: {} });
    return { status: 200, json: await enrichBooking(store, await store.getBooking(b.id)) };
  }

  // booking detail (with the linked case's full activity trail)
  if (seg[1] === 'bookings' && seg.length === 3 && method === 'GET') {
    const b = await store.getBooking(seg[2]);
    if (!b) return { status: 404, json: { error: 'not found' } };
    const out = await enrichBooking(store, b);
    out.events = b.caseId ? await store.listCaseEvents(b.caseId) : [];
    const atts = b.caseId ? await store.listAttachments(b.caseId) : [];
    out.pdfUrl = atts.filter((a) => a.kind === 'pdf').map((a) => a.url).pop() || null;
    return { status: 200, json: out };
  }

  if (seg[1] === 'bookings' && seg[3] === 'reschedule' && method === 'POST') {
    const b = await store.getBooking(seg[2]);
    if (!b) return { status: 404, json: { error: 'not found' } };
    if (!body?.slotId) return { status: 400, json: { error: 'slotId required' } };
    let updated;
    try {
      updated = await rescheduleBooking(store, b.id, body.slotId);
    } catch (e) {
      return { status: 409, json: { error: 'that slot is no longer available' } };
    }
    if (b.caseId) await store.addCaseEvent(b.caseId, { actor: user.name, type: 'rescheduled', payload: { slotId: body.slotId } });
    if (body?.notify && b.caseId) {
      const doctor = await store.getDoctor(updated.doctorId);
      const slot = await store.getSlot(updated.slotId);
      await adminSendUpdate(store, adapter, { caseId: b.caseId, key: 'booking_confirmed', actor: user.name, extraVars: { doctor: doctor?.name || '', slot: slot?.label || '' } });
    }
    return { status: 200, json: await enrichBooking(store, updated) };
  }

  if (seg[1] === 'bookings' && (seg[3] === 'visited' || seg[3] === 'no_show') && method === 'POST') {
    const b = await store.getBooking(seg[2]);
    if (!b) return { status: 404, json: { error: 'not found' } };
    const updated = seg[3] === 'visited' ? await markVisited(store, b.id) : await markNoShow(store, b.id);
    if (b.caseId) await store.addCaseEvent(b.caseId, { actor: user.name, type: seg[3], payload: {} });
    return { status: 200, json: await enrichBooking(store, updated) };
  }

  if (seg[1] === 'bookings' && seg[3] === 'remind' && method === 'POST') {
    const b = await store.getBooking(seg[2]);
    if (!b || !b.caseId) return { status: 404, json: { error: 'not found' } };
    const c = await store.getCase(b.caseId);
    const patient = await store.getPatient(c.waPhone);
    const doctor = await store.getDoctor(b.doctorId);
    const slot = await store.getSlot(b.slotId);
    await notifyPatient(store, adapter, { waPhone: c.waPhone, lang: patient?.lang || 'en', key: 'appointment_reminder', vars: { doctor: doctor?.name || '', slot: slot?.label || '' }, meta: { caseId: c.id } });
    await store.addCaseEvent(c.id, { actor: user.name, type: 'reminder_sent', payload: {} });
    return { status: 200, json: { sent: true } };
  }

  // open slots for a doctor (reschedule picker)
  if (seg[1] === 'slots' && method === 'GET') {
    if (!query.doctorId) return { status: 400, json: { error: 'doctorId required' } };
    return { status: 200, json: await store.listOpenSlots(query.doctorId) };
  }

  // CSV export of the visible cases
  if (path === '/api/export/cases.csv' && method === 'GET') {
    const rows = await Promise.all((await visibleCases(store, user)).map((c) => enrich(store, c, false)));
    return { status: 200, text: casesToCsv(rows), contentType: 'text/csv' };
  }

  // ---- patients (log book) ----
  if (path === '/api/patients' && method === 'GET') {
    const [pts, cases, bookings] = await Promise.all([store.listPatients(), store.listCases(), store.listBookings()]);
    const byBooking = Object.fromEntries(cases.filter((c) => c.bookingId).map((c) => [c.bookingId, c.waPhone]));
    const rows = pts
      .map((p) => {
        const pc = cases.filter((c) => c.waPhone === p.waPhone);
        const visits = bookings.filter((b) => byBooking[b.id] === p.waPhone && b.status === 'visited').length;
        const lastAt = pc.length ? Math.max(...pc.map((c) => c.createdAt)) : null;
        return { waPhone: p.waPhone, name: p.name || '·', lang: p.lang, tickets: pc.length, visits, lastAt };
      })
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return { status: 200, json: rows };
  }
  if (seg[1] === 'patients' && seg.length === 3 && method === 'GET') {
    const waPhone = decodeURIComponent(seg[2]);
    const p = await store.getPatient(waPhone);
    if (!p) return { status: 404, json: { error: 'not found' } };
    const [allCases, allBookings, records] = await Promise.all([store.listCases(), store.listBookings(), store.listPatientRecords(waPhone)]);
    const cases = await Promise.all(allCases.filter((c) => c.waPhone === waPhone).sort((a, b) => b.createdAt - a.createdAt).map((c) => enrich(store, c, false)));
    const bookings = await Promise.all(allBookings.filter((b) => cases.some((c) => c.bookingId === b.id)).map((b) => enrichBooking(store, b)));
    return { status: 200, json: { patient: { waPhone: p.waPhone, name: p.name, lang: p.lang, notes: p.notes || '' }, cases, bookings, records } };
  }
  if (seg[1] === 'patients' && seg[3] === 'records' && method === 'POST') {
    if (!body?.note) return { status: 400, json: { error: 'note required' } };
    const rec = await store.addPatientRecord(decodeURIComponent(seg[2]), { kind: body.kind || 'note', note: body.note, author: user.name });
    return { status: 200, json: rec };
  }
  if (seg[1] === 'patients' && seg.length === 3 && method === 'PATCH') {
    return { status: 200, json: await store.updatePatient(decodeURIComponent(seg[2]), { notes: body?.notes }) };
  }

  // ---- doctors + slots ----
  if (path === '/api/doctors' && method === 'GET') {
    const [docs, cases, bookings, users] = await Promise.all([store.listDoctors(), store.listCases(), store.listBookings(), store.listUsers()]);
    const caseById = Object.fromEntries(cases.map((c) => [c.id, c]));
    const docRatings = {};
    for (const b of bookings) {
      const c = b.caseId ? caseById[b.caseId] : null;
      if (c && c.rating != null) (docRatings[b.doctorId] ||= []).push(c.rating);
    }
    const acct = Object.fromEntries(users.filter((u) => u.doctorId).map((u) => [u.doctorId, u]));
    const out = await Promise.all(docs.map(async (d) => {
      const sl = await store.listSlotsByDoctor(d.id);
      const r = docRatings[d.id] || [];
      const a = acct[d.id];
      return { ...d, openSlots: sl.filter((s) => s.status === 'open').length, totalSlots: sl.length, avgRating: r.length ? Number((r.reduce((x, y) => x + y, 0) / r.length).toFixed(1)) : null, ratingCount: r.length, hasAccount: !!a, onLeave: a ? !!a.onLeave : false };
    }));
    return { status: 200, json: out };
  }
  if (path === '/api/doctors' && method === 'POST') {
    if (!body?.name || !body?.department) return { status: 400, json: { error: 'name and department required' } };
    return { status: 200, json: await store.addDoctor({ name: body.name, department: body.department }) };
  }
  if (seg[1] === 'doctors' && seg.length === 3 && method === 'PATCH') {
    return { status: 200, json: await store.updateDoctor(seg[2], { name: body?.name, department: body?.department, active: body?.active }) };
  }
  if (seg[1] === 'doctors' && seg[3] === 'slots' && method === 'GET') {
    return { status: 200, json: await store.listSlotsByDoctor(seg[2]) };
  }
  if (seg[1] === 'doctors' && seg[3] === 'slots' && method === 'POST') {
    if (!body?.label) return { status: 400, json: { error: 'label required' } };
    return { status: 200, json: await store.addSlot({ doctorId: seg[2], label: body.label, startAt: body.startAt || null, capacity: Number(body.capacity) || 1 }) };
  }
  if (seg[1] === 'slots' && seg.length === 3 && method === 'DELETE') {
    const r = await store.deleteSlot(seg[2]);
    return { status: r.ok ? 200 : 409, json: r.ok ? { ok: true } : { error: r.reason } };
  }
  if (seg[1] === 'slots' && seg.length === 3 && method === 'PATCH') {
    return { status: 200, json: await store.updateSlot(seg[2], { label: body?.label, capacity: body?.capacity, status: body?.status }) };
  }

  // ---- staff (team directory) ----
  if (path === '/api/staff' && method === 'GET') {
    const [staff, cases, teams] = await Promise.all([store.listUsers(), store.listCases(), store.listTeams()]);
    const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
    return { status: 200, json: staff.map((u) => {
      const mine = cases.filter((c) => c.assigneeId === u.id);
      const rated = mine.map((c) => c.rating).filter((r) => r != null);
      return { id: u.id, name: u.name, login: u.login, role: u.role, teamId: u.teamId, teamName: u.teamId ? teamName[u.teamId] : '·', phone: u.phone || '', hours: u.hours || '', onLeave: !!u.onLeave, active: u.active !== false, assigned: mine.filter((c) => isOpen(c)).length, resolved: mine.filter((c) => c.status === 'resolved' || c.status === 'closed').length, avgRating: rated.length ? Number((rated.reduce((x, y) => x + y, 0) / rated.length).toFixed(1)) : null };
    }) };
  }
  if (path === '/api/staff' && method === 'POST') {
    if (!isAdmin(user)) return { status: 403, json: { error: 'only an admin can add staff' } };
    if (!body?.name || !body?.login || !body?.password) return { status: 400, json: { error: 'name, login and password required' } };
    if (await store.getUserByLogin(body.login)) return { status: 409, json: { error: 'that login already exists' } };
    const u = await store.addUser({ name: body.name, login: body.login, role: body.role || 'agent', teamId: body.teamId || null, phone: body.phone || null, hours: body.hours || null, passwordHash: hashPassword(body.password) });
    return { status: 200, json: publicUserFull(u) };
  }
  if (seg[1] === 'staff' && seg.length === 3 && method === 'PATCH') {
    if (!isAdmin(user) && user.id !== seg[2]) return { status: 403, json: { error: 'forbidden' } };
    const u = await store.updateUser(seg[2], { name: body?.name, teamId: body?.teamId, role: body?.role, phone: body?.phone, hours: body?.hours, onLeave: body?.onLeave, active: body?.active });
    return { status: 200, json: u ? publicUserFull(u) : null };
  }

  // ---- feedback ----
  if (path === '/api/feedback' && method === 'GET') {
    const cases = await store.listCases();
    const rated = cases.filter((c) => c.rating != null);
    const items = await Promise.all(rated.slice().sort((a, b) => (b.resolvedAt || b.createdAt) - (a.resolvedAt || a.createdAt)).map((c) => enrich(store, c, false)));
    const distribution = {};
    for (let i = 1; i <= 10; i++) distribution[i] = 0;
    rated.forEach((c) => { if (distribution[c.rating] != null) distribution[c.rating]++; });
    const avg = rated.length ? Number((rated.reduce((a, c) => a + c.rating, 0) / rated.length).toFixed(1)) : null;
    return { status: 200, json: { items, avg, count: rated.length, distribution } };
  }

  // ---- alerts (current, not range-scoped) ----
  if (path === '/api/alerts' && method === 'GET') {
    const m = await computeMetrics(store, {});
    return { status: 200, json: m.alerts };
  }

  // ---- staff daily check-in (IST date) ----
  if (path === '/api/me/shift' && method === 'GET') {
    const date = istToday();
    const shift = await store.getShift(user.id, date);
    // only ticket-working staff do a daily shift check-in (not admins or doctors)
    return { status: 200, json: { date, shift, needsCheckin: !shift && ['team_lead', 'agent'].includes(user.role) } };
  }
  if (path === '/api/me/shift' && method === 'POST') {
    const date = istToday();
    const shift = await store.addShift({ userId: user.id, date, startTime: body?.startTime || '', endTime: body?.endTime || '', weeklyLeaveDay: body?.weeklyLeaveDay || '' });
    return { status: 200, json: shift };
  }
  if (seg[1] === 'staff' && seg[3] === 'reset-password' && method === 'POST') {
    if (!isAdmin(user)) return { status: 403, json: { error: 'only an admin can reset passwords' } };
    if (!body?.password || String(body.password).length < 4) return { status: 400, json: { error: 'password must be at least 4 characters' } };
    const target = await store.getUser(seg[2]);
    if (!target) return { status: 404, json: { error: 'not found' } };
    await store.updateUser(seg[2], { passwordHash: hashPassword(body.password) });
    return { status: 200, json: { ok: true } };
  }

  return { status: 404, json: { error: 'no such route' } };
}

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function publicUserFull(u) {
  return { id: u.id, name: u.name, login: u.login, role: u.role, teamId: u.teamId, doctorId: u.doctorId || null, phone: u.phone, hours: u.hours, onLeave: u.onLeave, active: u.active };
}

async function makeConfirmationPdf(store, adapter, b, notify) {
  const c = b.caseId ? await store.getCase(b.caseId) : null;
  const patient = c ? await store.getPatient(c.waPhone) : null;
  const doctor = await store.getDoctor(b.doctorId);
  const slot = await store.getSlot(b.slotId);
  const buf = appointmentPdf({
    address: 'CP-221, Hahnemann Medinity Hospital Road, Gomti Nagar, Lucknow 226010',
    patient: patient?.name || '-',
    doctor: doctor?.name || '-',
    department: doctor?.department || '-',
    slot: slot?.label || '-',
    ticketNo: c?.humanNo || '-',
  });
  const dataUrl = 'data:application/pdf;base64,' + buf.toString('base64');
  if (b.caseId) await store.addAttachment(b.caseId, { url: dataUrl, kind: 'pdf', waMediaId: null });
  if (notify && c && typeof adapter.sendDocument === 'function') {
    try {
      await adapter.sendDocument(c.waPhone, { buffer: buf, filename: `appointment-${String(c.humanNo).replace('#', '')}.pdf`, caption: 'Your appointment confirmation' });
    } catch (e) {
      /* document send is best-effort */
    }
  }
  return dataUrl;
}

async function markAwaitingFeedback(store, c) {
  const patient = await store.getPatient(c.waPhone);
  const now = Date.now();
  await store.saveSession({ waPhone: c.waPhone, journey: 'root', step: 'awaiting_feedback', lang: patient?.lang || 'en', state: { caseId: c.id }, lastActivityAt: now, expiresAt: now + 3 * 86400000 });
}

function casesToCsv(rows) {
  const cols = ['humanNo', 'type', 'categoryName', 'status', 'patientName', 'patientPhone', 'roomBed', 'teamName', 'etaMin', 'rating', 'createdAt', 'resolvedAt'];
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => cell(c === 'createdAt' || c === 'resolvedAt' ? (r[c] ? new Date(r[c]).toISOString() : '') : r[c])).join(',')).join('\n');
  return head + '\n' + body;
}

// ---- helpers ----

const isAdmin = (u) => u.role === 'super_admin' || u.role === 'hospital';

function publicUser(u) {
  return { id: u.id, name: u.name, login: u.login, role: u.role, teamId: u.teamId, doctorId: u.doctorId || null };
}

async function visibleCases(store, user) {
  const all = await store.listCases();
  if (isAdmin(user)) return all;
  if (!user.teamId) return []; // doctors / unassigned users see no tickets
  return all.filter((c) => c.teamId === user.teamId);
}
function canSee(user, c) {
  return isAdmin(user) || (user.teamId && c.teamId === user.teamId);
}

async function enrich(store, c, detail) {
  const [patient, cat, team] = await Promise.all([
    store.getPatient(c.waPhone),
    c.categoryId ? store.getCategory(c.categoryId) : null,
    c.teamId ? store.getTeam(c.teamId) : null,
  ]);
  const base = {
    ...c,
    patientName: patient?.name || null,
    patientPhone: c.waPhone,
    categoryName: cat ? cat.en : c.categoryId,
    teamName: team?.name || c.teamId,
    slaBreached: isSlaBreached(c),
  };
  if (detail) {
    base.events = await store.listCaseEvents(c.id);
    base.attachments = await store.listAttachments(c.id);
    base.messages = await store.listMessages(c.waPhone);
    if (c.bookingId) base.booking = await enrichBooking(store, await store.getBooking(c.bookingId));
  }
  return base;
}

async function enrichBooking(store, b) {
  if (!b) return null;
  const [doctor, slot] = await Promise.all([store.getDoctor(b.doctorId), store.getSlot(b.slotId)]);
  const linkedCase = b.caseId ? await store.getCase(b.caseId) : null;
  const patient = linkedCase ? await store.getPatient(linkedCase.waPhone) : null;
  return {
    ...b,
    doctorName: doctor?.name || b.doctorId,
    slotLabel: slot?.label || b.slotId,
    patientName: patient?.name || null,
  };
}
