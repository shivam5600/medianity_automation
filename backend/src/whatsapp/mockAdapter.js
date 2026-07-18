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
    async sendDocument(waPhone, doc) {
      sent.push({ waPhone, kind: 'document', filename: doc.filename });
      return { ok: true };
    },
    // Tiny test image so the complaint-photo flow is exercisable without live WhatsApp.
    async downloadMedia() {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      return { buffer: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
    },
  };
}
