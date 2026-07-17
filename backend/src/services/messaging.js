// The SINGLE funnel for all patient-facing outbound. Both paths call here so nothing sends silently
// and everything is logged:
//   1. Admin-triggered  — staff click "Send update to patient" in the panel  -> adminSendUpdate()
//   2. Automated (n8n)   — reminders / confirmations / feedback nudges         -> notifyPatient()

import { t } from '../i18n.js';

export function notifyPatient(store, adapter, { waPhone, lang = 'en', key, vars = {}, meta = {} }) {
  const body = t(lang, key, vars);
  adapter.send(waPhone, { kind: 'text', body });
  store.addMessage({ waPhone, direction: 'out', body, templateKey: key, ...meta });
  return body;
}

// Admin action: resolve the case + patient, then send. Logged as a case event for the audit trail.
export function adminSendUpdate(store, adapter, { caseId, key, actor = 'staff', extraVars = {} }) {
  const c = store.getCase(caseId);
  if (!c) throw new Error(`Unknown case: ${caseId}`);
  const patient = store.getPatient(c.waPhone);
  const lang = patient?.lang || 'en';
  const vars = { no: c.humanNo, eta: c.etaMin, ...extraVars };
  store.addCaseEvent(caseId, { actor, type: 'notify', payload: { key } });
  return notifyPatient(store, adapter, { waPhone: c.waPhone, lang, key, vars, meta: { caseId } });
}
