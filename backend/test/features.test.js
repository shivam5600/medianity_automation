import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore } from '../src/store/memoryStore.js';
import { createMockAdapter } from '../src/whatsapp/mockAdapter.js';
import { handle } from '../src/journey/engine.js';
import { createComplaintCase, setStatus } from '../src/services/cases.js';
import { holdSlot, markVisited, rescheduleBooking, isRevisitPatient } from '../src/services/booking.js';

function fbSetup() {
  const store = createMemoryStore();
  const adapter = createMockAdapter();
  return { store, adapter, deps: { store, adapter } };
}

test('feedback: a 1-10 reply after resolution is recorded as the rating and closes the ticket', async () => {
  const { store, deps } = fbSetup();
  const p = '+91fb';
  const patient = await store.upsertPatient({ waPhone: p, name: 'A', lang: 'en' });
  const { case: c } = await createComplaintCase(store, { patient, categoryId: 'cleanliness', roomBed: '1', description: 'x' });
  await setStatus(store, c.id, 'resolved');
  const now = Date.now();
  await store.saveSession({ waPhone: p, journey: 'root', step: 'awaiting_feedback', lang: 'en', state: { caseId: c.id }, lastActivityAt: now, expiresAt: now + 86400000 });

  const r = await handle(deps, { waPhone: p, now, kind: 'text', text: '8' });
  assert.match(r.replies[r.replies.length - 1].body, /Thank you|धन्यवाद/);
  const updated = await store.getCase(c.id);
  assert.equal(updated.rating, 8);
  assert.equal(updated.status, 'closed');
  assert.equal(await store.getSession(p), null);
});

test('feedback: a non-numeric reply drops the marker and records no rating', async () => {
  const { store, deps } = fbSetup();
  const p = '+91fb2';
  const patient = await store.upsertPatient({ waPhone: p, name: 'A', lang: 'en' });
  const { case: c } = await createComplaintCase(store, { patient, categoryId: 'cleanliness', roomBed: '1', description: 'x' });
  await setStatus(store, c.id, 'resolved');
  const now = Date.now();
  await store.saveSession({ waPhone: p, journey: 'root', step: 'awaiting_feedback', lang: 'en', state: { caseId: c.id }, lastActivityAt: now, expiresAt: now + 86400000 });

  await handle(deps, { waPhone: p, now, kind: 'text', text: 'hello' });
  assert.equal((await store.getCase(c.id)).rating, null);
});

test('booking lifecycle: a visit flags the next booking as a revisit; reschedule frees the old slot', async () => {
  const store = createMemoryStore();
  const patient = { id: '+91rv', waPhone: '+91rv' };
  const b1 = await holdSlot(store, { slotId: 'slot_1', patient, now: 1000 });
  await markVisited(store, b1.id);
  assert.equal((await store.getBooking(b1.id)).status, 'visited');
  assert.equal(await isRevisitPatient(store, patient.id), true);

  const b2 = await holdSlot(store, { slotId: 'slot_2', patient, now: 2000 });
  const moved = await rescheduleBooking(store, b2.id, 'slot_3');
  assert.equal(moved.slotId, 'slot_3');
  assert.equal((await store.getSlot('slot_2')).status, 'open', 'old slot freed');
});

test('complaint with a photo stores a viewable image (data URL)', async () => {
  const { store, adapter } = fbSetup();
  const deps = { store, adapter };
  const p = '+91img';
  const btn = (id) => ({ waPhone: p, kind: 'interactive', replyId: id });
  await handle(deps, { waPhone: p, kind: 'text', text: 'hi', profileName: 'Img User' });
  await handle(deps, btn('lang_en'));
  await handle(deps, btn('name_yes'));
  await handle(deps, btn('menu_complaint'));
  await handle(deps, btn('cat_cleanliness'));
  await handle(deps, { waPhone: p, kind: 'text', text: '204' });
  await handle(deps, { waPhone: p, kind: 'text', text: 'Dirty floor' });
  await handle(deps, { waPhone: p, kind: 'image', media: { id: 'wamid_test', mimeType: 'image/png' } });

  const c = (await store.listCases())[0];
  const atts = await store.listAttachments(c.id);
  assert.equal(atts.length, 1);
  assert.match(atts[0].url, /^data:image\/png;base64,/);
});
