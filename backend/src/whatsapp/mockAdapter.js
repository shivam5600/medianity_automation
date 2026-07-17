// Test/dev adapter — records outbound instead of calling Meta. Exposes the SAME `send(waPhone, reply)`
// surface the real Cloud API adapter (whatsapp/cloudApi.js, TODO) will implement, so the engine and
// services are identical in tests and in production.

export function createMockAdapter() {
  const sent = [];
  return {
    sent,
    send(waPhone, reply) {
      sent.push({ waPhone, ...reply });
      return { ok: true };
    },
    for(waPhone) {
      return sent.filter((m) => m.waPhone === waPhone);
    },
    last(waPhone) {
      const list = waPhone ? this.for(waPhone) : sent;
      return list[list.length - 1] || null;
    },
    reset() {
      sent.length = 0;
    },
  };
}
