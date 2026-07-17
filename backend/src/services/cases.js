// Case lifecycle. A Case is the single backbone for BOTH journeys: a complaint and an
// appointment/enquiry are just two case types flowing through the same pipeline. (async: store I/O)

import { routeCategory } from './routing.js';

export async function createComplaintCase(store, { patient, categoryId, roomBed, description }) {
  const { team, etaMin } = await routeCategory(store, categoryId);
  const now = Date.now();
  const c = await store.createCase({
    type: 'complaint',
    categoryId,
    patientId: patient.id,
    waPhone: patient.waPhone,
    teamId: team.id,
    roomBed,
    description,
    etaMin,
    etaAt: now + etaMin * 60_000,
    slaDueAt: now + etaMin * 60_000,
  });
  await store.addCaseEvent(c.id, { actor: 'patient', type: 'created', payload: { categoryId, teamId: team.id } });
  return { case: c, team, etaMin };
}

export async function createAppointmentCase(store, { patient, doctor }) {
  const c = await store.createCase({
    type: 'enquiry',
    categoryId: 'appointment',
    patientId: patient.id,
    waPhone: patient.waPhone,
    teamId: 'front_desk',
    description: `Appointment request: ${doctor.name} (${doctor.department})`,
  });
  await store.addCaseEvent(c.id, { actor: 'patient', type: 'created', payload: { doctorId: doctor.id } });
  return c;
}

// Human takeover: the patient asked to talk to the team. Routed to Front Desk and flagged with a
// `staff_alert` event — the scheduler/n8n watches for that to ping support staff (Flock/WhatsApp).
export async function createSupportCase(store, { patient, message }) {
  const c = await store.createCase({
    type: 'support',
    categoryId: 'support',
    patientId: patient.id,
    waPhone: patient.waPhone,
    teamId: 'front_desk',
    description: message || 'Requested to talk to the team',
  });
  await store.addCaseEvent(c.id, { actor: 'patient', type: 'created', payload: { channel: 'handoff' } });
  await store.addCaseEvent(c.id, { actor: 'system', type: 'staff_alert', payload: { reason: 'support_handoff' } });
  return c;
}

const OPEN_STATUSES = ['new', 'assigned', 'in_progress'];

export async function setStatus(store, caseId, status, actor = 'staff') {
  const patch = { status };
  if (status === 'resolved') patch.resolvedAt = Date.now();
  const c = await store.updateCase(caseId, patch);
  await store.addCaseEvent(caseId, { actor, type: 'status', payload: { status } });
  return c;
}

export async function recordRating(store, caseId, rating) {
  const c = await store.updateCase(caseId, { rating, status: 'closed' });
  await store.addCaseEvent(caseId, { actor: 'patient', type: 'rating', payload: { rating } });
  return c;
}

export function isOpen(caseRow) {
  return OPEN_STATUSES.includes(caseRow.status);
}

export function isSlaBreached(caseRow, now = Date.now()) {
  return isOpen(caseRow) && caseRow.slaDueAt != null && now > caseRow.slaDueAt;
}
