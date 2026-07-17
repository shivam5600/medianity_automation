// Shared across the store implementations and the booking service (avoids a store<->service cycle).
export class SlotUnavailableError extends Error {
  constructor(message) {
    super(message || 'Slot unavailable');
    this.name = 'SlotUnavailableError';
  }
}
