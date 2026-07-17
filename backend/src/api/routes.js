// Admin JSON API. Returns { status, json }. Auth is a Bearer token except for /api/login.
// RBAC: super_admin sees everything; other roles see only their team's cases. (async: store I/O)

import { signToken, verifyToken, verifyPassword } from './auth.js';
import { computeMetrics } from './metrics.js';
import { setStatus, isSlaBreached } from '../services/cases.js';
import { adminSendUpdate, sendAgentMessage } from '../services/messaging.js';
import { confirmBooking, cancelBooking } from '../services/booking.js';

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
  if (path === '/api/metrics' && method === 'GET') return { status: 200, json: await computeMetrics(store) };
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
    if (body?.notify && b.caseId) {
      const doctor = await store.getDoctor(b.doctorId);
      const slot = await store.getSlot(b.slotId);
      await adminSendUpdate(store, adapter, {
        caseId: b.caseId,
        key: 'booking_confirmed',
        actor: user.name,
        extraVars: { doctor: doctor?.name || '', slot: slot?.label || '' },
      });
    }
    return { status: 200, json: await enrichBooking(store, await store.getBooking(b.id)) };
  }

  if (seg[1] === 'bookings' && seg[3] === 'cancel' && method === 'POST') {
    const b = await store.getBooking(seg[2]);
    if (!b) return { status: 404, json: { error: 'not found' } };
    await cancelBooking(store, b.id);
    return { status: 200, json: await enrichBooking(store, await store.getBooking(b.id)) };
  }

  return { status: 404, json: { error: 'no such route' } };
}

// ---- helpers ----

function publicUser(u) {
  return { id: u.id, name: u.name, login: u.login, role: u.role, teamId: u.teamId };
}

async function visibleCases(store, user) {
  const all = await store.listCases();
  if (user.role === 'super_admin' || !user.teamId) return all;
  return all.filter((c) => c.teamId === user.teamId);
}
function canSee(user, c) {
  return user.role === 'super_admin' || !user.teamId || c.teamId === user.teamId;
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
