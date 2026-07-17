// Shared helpers for the journey engine and journey definitions.

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h; beyond this a returning user starts fresh.

// Resolve which option a user picked. Works for interactive replies (replyId), a typed 1-based number,
// or the option title typed verbatim. Returns the matched option object or null.
export function resolveChoice(inbound, options) {
  if (!options || options.length === 0) return null;
  if (inbound.replyId) return options.find((o) => o.id === inbound.replyId) || null;

  const text = (inbound.text || '').trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const i = parseInt(text, 10) - 1;
    if (i >= 0 && i < options.length) return options[i];
  }
  const low = text.toLowerCase();
  return options.find((o) => (o.title || '').toLowerCase() === low) || null;
}

// Move the session to `step` and emit that step's prompt. `ctx.journey` must be set by the engine.
export function advance(ctx, step) {
  ctx.session.step = step;
  ctx.journey.steps[step].prompt(ctx);
}
