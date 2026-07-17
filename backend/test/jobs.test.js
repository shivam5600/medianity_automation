import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore } from '../src/store/memoryStore.js';
import { createMockAdapter } from '../src/whatsapp/mockAdapter.js';
import { createComplaintCase, setStatus } from '../src/services/cases.js';
import { runJobsOnce } from '../src/jobs.js';

test('scheduler: releases expired holds, flags SLA breach, nudges for feedback (once)', async () => {
  const store = createMemoryStore();
  const adapter = createMockAdapter();
  const deps = { store, adapter };
  const pat = await store.upsertPatient({ waPhone: '+91jobs', name: 'Test', lang: 'en' });

  // 1) an expired hold
  await store.tryHoldSlot({ slotId: 'slot_1', patient: pat, now: 1000 }); // expires at 1000 + 10min

  // 2) a resolved complaint with no rating
  const { case: resolved } = await createComplaintCase(store, { patient: pat, categoryId: 'cleanliness', roomBed: '1', description: 'x' });
  await setStatus(store, resolved.id, 'resolved');

  // 3) an open complaint whose SLA is in the past relative to `now`
  const { case: openC } = await createComplaintCase(store, { patient: pat, categoryId: 'nursing', roomBed: '2', description: 'y' });

  const now = Date.now() + 3 * 60 * 60 * 1000; // 3h ahead: past hold expiry, past SLA, >2h since resolve
  const r = await runJobsOnce(deps, now);

  assert.ok(r.released >= 1, 'expired hold released');
  assert.equal((await store.getSlot('slot_1')).status, 'open');
  assert.ok(r.escalated >= 1, 'SLA breach flagged');
  assert.ok((await store.listCaseEvents(openC.id)).some((e) => e.type === 'sla_breach'));
  assert.ok(r.nudged >= 1, 'feedback reminder sent');
  assert.ok(adapter.sent.some((m) => /feedback/i.test(m.body)));

  // idempotent: a second run does nothing new
  const r2 = await runJobsOnce(deps, now);
  assert.deepEqual([r2.released, r2.escalated, r2.nudged], [0, 0, 0]);
});
