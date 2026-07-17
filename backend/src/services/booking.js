// Slot booking with an atomic hold — the core guarantee is NO DOUBLE-BOOKING under concurrent taps.
//
// Memory store: JS is single-threaded, so the read-check-write below is naturally atomic.
// Postgres store (pgStore) reproduces the SAME guarantee across processes/instances with:
//   BEGIN; SELECT ... FROM slots WHERE id=$1 FOR UPDATE;  -- row lock
//   (check booked_count < capacity) UPDATE slots SET booked_count=booked_count+1 ...;
//   INSERT INTO bookings (...) VALUES (... 'held' ...); COMMIT;
// The interface is identical, so the journey engine never knows which store it is talking to.

export class SlotUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SlotUnavailableError';
  }
}

export const HOLD_MINUTES = 10;

export function holdSlot(store, { slotId, patient, caseId = null, now = Date.now() }) {
  const slot = store.getSlot(slotId);
  if (!slot || slot.status !== 'open' || slot.bookedCount >= slot.capacity) {
    throw new SlotUnavailableError(`Slot ${slotId} is not available`);
  }
  const bookedCount = slot.bookedCount + 1;
  store._setSlot({
    ...slot,
    bookedCount,
    status: bookedCount >= slot.capacity ? 'full' : 'open',
  });
  return store.addBooking({
    slotId,
    doctorId: slot.doctorId,
    patientId: patient.id,
    caseId,
    status: 'held',
    holdExpiresAt: now + HOLD_MINUTES * 60_000,
  });
}

export function confirmBooking(store, bookingId) {
  return store.updateBooking(bookingId, { status: 'confirmed' });
}

export function cancelBooking(store, bookingId, reason = 'cancelled') {
  const b = store.updateBooking(bookingId, { status: 'cancelled', cancelReason: reason });
  releaseSlot(store, b.slotId);
  return b;
}

// Frees holds that were never confirmed in time. Run by the app or by an n8n cron.
export function releaseExpiredHolds(store, now = Date.now()) {
  let released = 0;
  for (const b of store.listBookings()) {
    if (b.status === 'held' && b.holdExpiresAt <= now) {
      store.updateBooking(b.id, { status: 'cancelled', cancelReason: 'hold_expired' });
      releaseSlot(store, b.slotId);
      released++;
    }
  }
  return released;
}

function releaseSlot(store, slotId) {
  const slot = store.getSlot(slotId);
  if (!slot) return;
  store._setSlot({
    ...slot,
    bookedCount: Math.max(0, slot.bookedCount - 1),
    status: 'open',
  });
}
