// The SINGLE funnel for all patient-facing outbound. Every path logs, so nothing sends silently:
//   1. Admin-triggered  — "Send update to patient" in the panel        -> adminSendUpdate()
//   2. Automated        — reminders / confirmations / feedback nudges   -> notifyPatient()
//   3. Two-way inbox    — an agent typing a free reply from the panel   -> sendAgentMessage()

import { t } from '../i18n.js';

export async function notifyPatient(store, adapter, { waPhone, lang = 'en', key, vars = {}, meta = {} }) {
  const body = t(lang, key, vars);
  await adapter.send(waPhone, { kind: 'text', body });
  await store.addMessage({ waPhone, direction: 'out', body, templateKey: key, ...meta });
  return body;
}

// Admin action: resolve the case + patient, then send. Logged as a case event for the audit trail.
export async function adminSendUpdate(store, adapter, { caseId, key, actor = 'staff', extraVars = {} }) {
  const c = await store.getCase(caseId);
  if (!c) throw new Error(`Unknown case: ${caseId}`);
  const patient = await store.getPatient(c.waPhone);
  const lang = patient?.lang || 'en';
  const vars = { no: c.humanNo, eta: c.etaMin, ...extraVars };
  await store.addCaseEvent(caseId, { actor, type: 'notify', payload: { key } });
  return notifyPatient(store, adapter, { waPhone: c.waPhone, lang, key, vars, meta: { caseId } });
}

// Two-way inbox: a free-text reply typed by a staff member. (Note: Meta only allows free-form text
// within the 24h customer-service window; outside it a template is required.)
export async function sendAgentMessage(store, adapter, { waPhone, body, actor = 'staff', caseId = null }) {
  await adapter.send(waPhone, { kind: 'text', body });
  return store.addMessage({ waPhone, direction: 'out', body, agent: actor, caseId });
}
