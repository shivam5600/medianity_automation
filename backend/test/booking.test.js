import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore } from '../src/store/memoryStore.js';
import { holdSlot, releaseExpiredHolds, confirmBooking, SlotUnavailableError } from '../src/services/booking.js';

const patient = (id) => ({ id, waPhone: `+91${id}` });

test('a capacity-1 slot can be held once; the second hold is rejected (no double-booking)', () => {
  const store = createMemoryStore();
  const b1 = holdSlot(store, { slotId: 'slot_1', patient: patient('a'), now: 1000 });
  assert.equal(b1.status, 'held');
  assert.equal(store.getSlot('slot_1').status, 'full');

  assert.throws(
    () => holdSlot(store, { slotId: 'slot_1', patient: patient('b'), now: 1000 }),
    SlotUnavailableError,
  );
});

test('a capacity-2 slot accepts two holds, rejects the third', () => {
  const store = createMemoryStore();
  holdSlot(store, { slotId: 'slot_3', patient: patient('a'), now: 1000 });
  holdSlot(store, { slotId: 'slot_3', patient: patient('b'), now: 1000 });
  assert.equal(store.getSlot('slot_3').bookedCount, 2);
  assert.throws(
    () => holdSlot(store, { slotId: 'slot_3', patient: patient('c'), now: 1000 }),
    SlotUnavailableError,
  );
});

test('an expired hold is released and the slot re-opens', () => {
  const store = createMemoryStore();
  const b = holdSlot(store, { slotId: 'slot_1', patient: patient('a'), now: 1000 });
  assert.equal(store.getSlot('slot_1').status, 'full');

  const released = releaseExpiredHolds(store, b.holdExpiresAt + 1);
  assert.equal(released, 1);
  assert.equal(store.getSlot('slot_1').status, 'open');
  assert.equal(store.getSlot('slot_1').bookedCount, 0);

  // slot is bookable again
  const b2 = holdSlot(store, { slotId: 'slot_1', patient: patient('b'), now: b.holdExpiresAt + 2 });
  assert.equal(b2.status, 'held');
});

test('a confirmed hold is NOT released by the expiry sweep', () => {
  const store = createMemoryStore();
  const b = holdSlot(store, { slotId: 'slot_1', patient: patient('a'), now: 1000 });
  confirmBooking(store, b.id);
  const released = releaseExpiredHolds(store, b.holdExpiresAt + 1);
  assert.equal(released, 0);
  assert.equal(store.getSlot('slot_1').status, 'full');
});
