// Case lifecycle. A Case is the single backbone for BOTH journeys: a complaint and an
// appointment/enquiry are just two case types flowing through the same pipeline.

import { routeCategory } from './routing.js';

export function createComplaintCase(store, { patient, categoryId, roomBed, description }) {
  const { team, etaMin } = routeCategory(store, categoryId);
  const now = Date.now();
  const c = store.createCase({
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
  store.addCaseEvent(c.id, { actor: 'patient', type: 'created', payload: { categoryId, teamId: team.id } });
  return { case: c, team, etaMin };
}

export function createAppointmentCase(store, { patient, doctor }) {
  const c = store.createCase({
    type: 'enquiry',
    categoryId: 'appointment',
    patientId: patient.id,
    waPhone: patient.waPhone,
    teamId: 'front_desk',
    description: `Appointment request: ${doctor.name} (${doctor.department})`,
  });
  store.addCaseEvent(c.id, { actor: 'patient', type: 'created', payload: { doctorId: doctor.id } });
  return c;
}

// Human takeover: the patient asked to talk to the team. Routed to Front Desk and flagged with a
// `staff_alert` event — the backend/n8n watches for that to ping support staff (Flock/WhatsApp).
export function createSupportCase(store, { patient, message }) {
  const c = store.createCase({
    type: 'support',
    categoryId: 'support',
    patientId: patient.id,
    waPhone: patient.waPhone,
    teamId: 'front_desk',
    description: message || 'Requested to talk to the team',
  });
  store.addCaseEvent(c.id, { actor: 'patient', type: 'created', payload: { channel: 'handoff' } });
  store.addCaseEvent(c.id, { actor: 'system', type: 'staff_alert', payload: { reason: 'support_handoff' } });
  return c;
}

const OPEN_STATUSES = ['new', 'assigned', 'in_progress'];

export function setStatus(store, caseId, status, actor = 'staff') {
  const patch = { status };
  if (status === 'resolved') patch.resolvedAt = Date.now();
  const c = store.updateCase(caseId, patch);
  store.addCaseEvent(caseId, { actor, type: 'status', payload: { status } });
  return c;
}

export function recordRating(store, caseId, rating) {
  const c = store.updateCase(caseId, { rating, status: 'closed' });
  store.addCaseEvent(caseId, { actor: 'patient', type: 'rating', payload: { rating } });
  return c;
}

export function isOpen(caseRow) {
  return OPEN_STATUSES.includes(caseRow.status);
}

export function isSlaBreached(caseRow, now = Date.now()) {
  return isOpen(caseRow) && caseRow.slaDueAt != null && now > caseRow.slaDueAt;
}
