// In-process scheduler for the timed flows. Because the backend is a single persistent service,
// these run on an interval rather than needing an external n8n cron (n8n can still be added later
// for the Google-Sheet mirror). Each job is idempotent — it records a case event so it never fires
// twice for the same case.

import { releaseExpiredHolds } from './services/booking.js';
import { isSlaBreached } from './services/cases.js';
import { notifyPatient } from './services/messaging.js';

const HOUR = 60 * 60 * 1000;

export async function runJobsOnce(deps, now = Date.now()) {
  const { store, adapter } = deps;
  const released = await releaseExpiredHolds(store, now);
  const escalated = await slaEscalation(store, now);
  const nudged = await feedbackReminders(store, adapter, now);
  const reminded = await appointmentReminders(store, adapter, now);
  return { released, escalated, nudged, reminded };
}

export function startScheduler(deps, { intervalMs = 5 * 60 * 1000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runJobsOnce(deps);
      if (r.released || r.escalated || r.nudged || r.reminded) console.log('[jobs]', r);
    } catch (e) {
      console.error('[jobs] error:', e);
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

// Flag complaint tickets that have blown their SLA (once), so the panel can surface them.
async function slaEscalation(store, now) {
  let n = 0;
  for (const c of await store.listCases()) {
    if (c.type !== 'complaint' || !isSlaBreached(c, now)) continue;
    const events = await store.listCaseEvents(c.id);
    if (!events.some((e) => e.type === 'sla_breach')) {
      await store.addCaseEvent(c.id, { actor: 'system', type: 'sla_breach', payload: { slaDueAt: c.slaDueAt } });
      n++;
    }
  }
  return n;
}

// Nudge patients who were resolved > 2h ago and have not rated yet (once).
async function feedbackReminders(store, adapter, now) {
  let n = 0;
  for (const c of await store.listCases()) {
    if (c.status !== 'resolved' || c.rating != null || !c.resolvedAt || now - c.resolvedAt < 2 * HOUR) continue;
    const events = await store.listCaseEvents(c.id);
    if (events.some((e) => e.type === 'feedback_reminder')) continue;
    const patient = await store.getPatient(c.waPhone);
    await notifyPatient(store, adapter, { waPhone: c.waPhone, lang: patient?.lang || 'en', key: 'feedback_reminder', vars: { no: c.humanNo }, meta: { caseId: c.id } });
    await store.addCaseEvent(c.id, { actor: 'system', type: 'feedback_reminder', payload: {} });
    // mark so the patient's 1-10 reply is captured as a rating
    await store.saveSession({ waPhone: c.waPhone, journey: 'root', step: 'awaiting_feedback', lang: patient?.lang || 'en', state: { caseId: c.id }, lastActivityAt: now, expiresAt: now + 3 * 60 * 60 * 1000 * 24 });
    n++;
  }
  return n;
}

// Remind for confirmed bookings starting within the next 24h (once).
async function appointmentReminders(store, adapter, now) {
  let n = 0;
  for (const b of await store.listBookings()) {
    if (b.status !== 'confirmed' || !b.caseId) continue;
    const slot = await store.getSlot(b.slotId);
    const startMs = slot?.startAt ? Date.parse(slot.startAt) : NaN;
    if (Number.isNaN(startMs) || startMs <= now || startMs - now > 24 * HOUR) continue;
    const events = await store.listCaseEvents(b.caseId);
    if (events.some((e) => e.type === 'appt_reminder')) continue;
    const c = await store.getCase(b.caseId);
    const patient = await store.getPatient(c.waPhone);
    const doctor = await store.getDoctor(b.doctorId);
    await notifyPatient(store, adapter, { waPhone: c.waPhone, lang: patient?.lang || 'en', key: 'appointment_reminder', vars: { doctor: doctor?.name || '', slot: slot.label }, meta: { caseId: c.id } });
    await store.addCaseEvent(c.id, { actor: 'system', type: 'appt_reminder', payload: {} });
    n++;
  }
  return n;
}
