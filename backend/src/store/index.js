// Store factory: Postgres when DATABASE_URL is set, otherwise the in-memory store.

import { createMemoryStore } from './memoryStore.js';

export async function createStore(config) {
  if (config.databaseUrl) {
    const { createPgStore } = await import('./pgStore.js');
    const store = await createPgStore(config.databaseUrl);
    await store.init(); // idempotent migrations + config seed; fail-loud
    return store;
  }
  const store = createMemoryStore();
  await store.init();
  return store;
}
