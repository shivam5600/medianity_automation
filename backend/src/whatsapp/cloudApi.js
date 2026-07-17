// Meta WhatsApp Cloud API adapter. Implements the SAME send(waPhone, reply) surface as mockAdapter,
// so the engine is byte-for-byte identical in tests and in production. Uses global fetch (Node 20+).
//
// reply shapes emitted by the engine:
//   { kind:'text',    body }
//   { kind:'buttons', body, buttons:[{id,title}] }   -> interactive reply buttons (max 3)
//   { kind:'list',    body, sections:[{id,title}] }  -> interactive list (max 10 rows)

export function createCloudApiAdapter(wa) {
  const base = `https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}`;
  const authHeaders = { Authorization: `Bearer ${wa.token}` };

  async function postMessage(payload) {
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (!res.ok) {
      // Fail loud — do not swallow send failures.
      throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }

  return {
    async send(waPhone, reply) {
      const to = String(waPhone).replace(/[^0-9]/g, '');

      if (reply.kind === 'buttons') {
        return postMessage({
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: reply.body },
            action: {
              buttons: (reply.buttons || []).slice(0, 3).map((b) => ({
                type: 'reply',
                reply: { id: b.id, title: b.title.slice(0, 20) }, // Meta cap: 20 chars
              })),
            },
          },
        });
      }

      if (reply.kind === 'list') {
        return postMessage({
          to,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: reply.body },
            action: {
              button: 'Select',
              sections: [
                {
                  title: 'Options',
                  rows: (reply.sections || []).slice(0, 10).map((o) => ({
                    id: o.id,
                    title: o.title.slice(0, 24), // Meta cap: 24 chars
                  })),
                },
              ],
            },
          },
        });
      }

      return postMessage({ to, type: 'text', text: { body: reply.body } });
    },

    // Download an inbound media object (e.g. a complaint photo) so it can be stored off WhatsApp.
    async downloadMedia(mediaId) {
      const metaRes = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${mediaId}`, {
        headers: authHeaders,
      });
      if (!metaRes.ok) throw new Error(`media lookup failed (${metaRes.status})`);
      const meta = await metaRes.json();
      const binRes = await fetch(meta.url, { headers: authHeaders });
      if (!binRes.ok) throw new Error(`media download failed (${binRes.status})`);
      return { buffer: Buffer.from(await binRes.arrayBuffer()), mimeType: meta.mime_type };
    },
  };
}
