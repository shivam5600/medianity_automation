// Booking service — thin async wrappers over the store's ATOMIC operations. The no-double-booking
// guarantee lives inside store.tryHoldSlot (memory: single no-await body; pg: transaction + row
// lock), so it holds identically regardless of which store backs the app.

import { SlotUnavailableError } from '../errors.js';

export { SlotUnavailableError };
export const HOLD_MINUTES = 10;

export function holdSlot(store, { slotId, patient, caseId = null, now = Date.now() }) {
  return store.tryHoldSlot({ slotId, patient, caseId, holdMinutes: HOLD_MINUTES, now });
}

export function confirmBooking(store, bookingId) {
  return store.confirmBooking(bookingId);
}

export function cancelBooking(store, bookingId, reason = 'cancelled') {
  return store.cancelBooking(bookingId, reason);
}

// Frees holds that were never confirmed in time. Run by the scheduler (jobs.js) or an n8n cron.
export function releaseExpiredHolds(store, now = Date.now()) {
  return store.releaseExpiredHolds(now);
}
