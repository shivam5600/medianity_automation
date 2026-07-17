// Portable config: reads a gitignored creds.local.json sitting beside the backend, with env vars
// taking precedence. No secrets in code, no external SA paths — scp the file and run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = process.env.CREDS_FILE || path.join(here, '..', 'creds.local.json');

let fileCreds = {};
try {
  fileCreds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
} catch {
  // No creds file — rely on environment variables (fine in hosted envs like Render).
}

const get = (key, fallback = undefined) => process.env[key] ?? fileCreds[key] ?? fallback;

export const config = {
  port: Number(get('PORT', 8098)),
  databaseUrl: get('DATABASE_URL', null), // when set -> Postgres; otherwise in-memory (pilot/demo)
  sessionSecret: get('SESSION_SECRET', 'dev-medinity-secret-change-me'),
  seedDemo: String(get('SEED_DEMO', '1')) === '1', // seed sample cases so the panel has data (pilot)
  whatsapp: {
    phoneNumberId: get('WA_PHONE_NUMBER_ID', null),
    token: get('WA_TOKEN', null),
    verifyToken: get('WA_VERIFY_TOKEN', 'medinity-verify'),
    apiVersion: get('WA_API_VERSION', 'v21.0'),
    appSecret: get('WA_APP_SECRET', null), // optional inbound signature check
  },
};

// Fail loud: never silently start with a half-configured WhatsApp connection in production.
export function assertWhatsAppConfigured() {
  const w = config.whatsapp;
  const missing = ['phoneNumberId', 'token'].filter((k) => !w[k]);
  if (missing.length) {
    throw new Error(
      `WhatsApp Cloud API not configured — missing ${missing.map((k) => `WA_${k === 'phoneNumberId' ? 'PHONE_NUMBER_ID' : 'TOKEN'}`).join(', ')}. ` +
        `Set them in ${CREDS_PATH} or the environment.`,
    );
  }
}
