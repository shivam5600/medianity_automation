// Seeds admin users (pilot defaults) and, optionally, sample cases so the panel has data to show.
// Only used by the running server — NOT by the default store (keeps the journey tests fast + clean).

import { hashPassword } from './auth.js';
import { createComplaintCase, createAppointmentCase, createSupportCase, setStatus, recordRating } from '../services/cases.js';
import { holdSlot, confirmBooking, markVisited } from '../services/booking.js';

// Pilot logins (documented in README). Change SESSION_SECRET + these before real use.
export async function seedAdminUsers(store) {
  if ((await store.listUsers()).length) return;
  const mk = (name, login, role, teamId, pw) =>
    store.addUser({ name, login, role, teamId, passwordHash: hashPassword(pw) });
  await mk('Admin', 'admin@medinity.local', 'super_admin', null, 'medinity@123');
  await mk('Front Desk', 'frontdesk@medinity.local', 'team_lead', 'front_desk', 'front@123');
  await mk('Housekeeping Lead', 'housekeeping@medinity.local', 'team_lead', 'housekeeping', 'house@123');
}

export async function seedDemo(store) {
  if ((await store.listCases()).length) return;
  const P = (waPhone, name, lang = 'en') => store.upsertPatient({ waPhone, name, lang });

  const p1 = await P('+919990000001', 'Ramesh Kumar');
  const { case: c1 } = await createComplaintCase(store, { patient: p1, categoryId: 'cleanliness', roomBed: '204', description: 'Bed sheet is dirty' });
  // a sample attached photo (tiny data URL) to demonstrate image display in the panel
  await store.addAttachment(c1.id, { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', waMediaId: 'demo', kind: 'image' });

  const p2 = await P('+919990000002', 'Sunita Devi', 'hi');
  const { case: c2 } = await createComplaintCase(store, { patient: p2, categoryId: 'ac_electrical', roomBed: '310', description: 'AC not cooling' });
  await setStatus(store, c2.id, 'assigned');

  const p3 = await P('+919990000003', 'Amit Singh');
  const { case: c3 } = await createComplaintCase(store, { patient: p3, categoryId: 'food', roomBed: '118', description: 'Food served cold' });
  await setStatus(store, c3.id, 'in_progress');
  await setStatus(store, c3.id, 'resolved');
  await recordRating(store, c3.id, 4);

  // appointment -> confirmed (funnel: booked)
  const p4 = await P('+919990000004', 'Neha Verma');
  const drO = await store.getDoctor('doc_ortho_1');
  const cA = await createAppointmentCase(store, { patient: p4, doctor: drO });
  const b = await holdSlot(store, { slotId: 'slot_1', patient: p4, caseId: cA.id });
  await store.updateBooking(b.id, { caseId: cA.id });
  await store.updateCase(cA.id, { bookingId: b.id });
  await confirmBooking(store, b.id);

  // appointment -> confirmed -> visited (funnel: visited)
  const p6 = await P('+919990000006', 'Kiran Rao');
  const drG = await store.getDoctor('doc_gyn_1');
  const cB = await createAppointmentCase(store, { patient: p6, doctor: drG });
  const b2 = await holdSlot(store, { slotId: 'slot_3', patient: p6, caseId: cB.id });
  await store.updateBooking(b2.id, { caseId: cB.id });
  await store.updateCase(cB.id, { bookingId: b2.id });
  await confirmBooking(store, b2.id);
  await markVisited(store, b2.id);

  // a still-pending hold (kept from expiry) so the "pending bookings" alert + actions show
  const p7 = await P('+919990000007', 'Asha Gupta');
  const cC = await createAppointmentCase(store, { patient: p7, doctor: drO });
  const b3 = await holdSlot(store, { slotId: 'slot_2', patient: p7, caseId: cC.id });
  await store.updateBooking(b3.id, { caseId: cC.id, holdExpiresAt: Date.now() + 30 * 86400000 });
  await store.updateCase(cC.id, { bookingId: b3.id });

  const p5 = await P('+919990000005', 'Vikas Yadav');
  await createSupportCase(store, { patient: p5, message: 'Need help with the discharge process' });
}
