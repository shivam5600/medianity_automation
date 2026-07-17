import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore } from '../src/store/memoryStore.js';
import { holdSlot, releaseExpiredHolds, confirmBooking, SlotUnavailableError } from '../src/services/booking.js';

const patient = (id) => ({ id, waPhone: `+91${id}` });

test('a capacity-1 slot can be held once; the second hold is rejected (no double-booking)', async () => {
  const store = createMemoryStore();
  const b1 = await holdSlot(store, { slotId: 'slot_1', patient: patient('a'), now: 1000 });
  assert.equal(b1.status, 'held');
  assert.equal((await store.getSlot('slot_1')).status, 'full');

  await assert.rejects(
    () => holdSlot(store, { slotId: 'slot_1', patient: patient('b'), now: 1000 }),
    SlotUnavailableError,
  );
});

test('a capacity-2 slot accepts two holds, rejects the third', async () => {
  const store = createMemoryStore();
  await holdSlot(store, { slotId: 'slot_3', patient: patient('a'), now: 1000 });
  await holdSlot(store, { slotId: 'slot_3', patient: patient('b'), now: 1000 });
  assert.equal((await store.getSlot('slot_3')).bookedCount, 2);
  await assert.rejects(
    () => holdSlot(store, { slotId: 'slot_3', patient: patient('c'), now: 1000 }),
    SlotUnavailableError,
  );
});

test('an expired hold is released and the slot re-opens', async () => {
  const store = createMemoryStore();
  const b = await holdSlot(store, { slotId: 'slot_1', patient: patient('a'), now: 1000 });
  assert.equal((await store.getSlot('slot_1')).status, 'full');

  const released = await releaseExpiredHolds(store, b.holdExpiresAt + 1);
  assert.equal(released, 1);
  assert.equal((await store.getSlot('slot_1')).status, 'open');
  assert.equal((await store.getSlot('slot_1')).bookedCount, 0);

  const b2 = await holdSlot(store, { slotId: 'slot_1', patient: patient('b'), now: b.holdExpiresAt + 2 });
  assert.equal(b2.status, 'held');
});

test('a confirmed hold is NOT released by the expiry sweep', async () => {
  const store = createMemoryStore();
  const b = await holdSlot(store, { slotId: 'slot_1', patient: patient('a'), now: 1000 });
  await confirmBooking(store, b.id);
  const released = await releaseExpiredHolds(store, b.holdExpiresAt + 1);
  assert.equal(released, 0);
  assert.equal((await store.getSlot('slot_1')).status, 'full');
});

test('concurrent holds on a capacity-1 slot: exactly one wins', async () => {
  const store = createMemoryStore();
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => holdSlot(store, { slotId: 'slot_1', patient: patient('c' + i), now: 1000 })),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  assert.equal(ok, 1, 'exactly one hold succeeds');
  assert.equal(rejected, 4);
  assert.equal((await store.getSlot('slot_1')).bookedCount, 1);
});
