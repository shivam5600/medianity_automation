// Idempotent migrations + config seed. Runs on pgStore.init() (every boot) and via `npm run migrate`.
// Fail-loud: the CLI exits non-zero on any error (never a silent half-migrated schema).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultSeed } from '../data/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool) {
  const sql = fs.readFileSync(path.join(here, 'migrations', '001_init.sql'), 'utf8');
  await pool.query(sql);
  await seedConfig(pool);
}

async function seedConfig(pool) {
  const { teams, categories, doctors, slots } = defaultSeed();
  for (const t of teams) {
    await pool.query('INSERT INTO teams (id,name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=$2', [t.id, t.name]);
  }
  for (const c of categories) {
    await pool.query(
      'INSERT INTO categories (id,en,hi,team,eta_min,journey_type) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET en=$2,hi=$3,team=$4,eta_min=$5,journey_type=$6',
      [c.id, c.en, c.hi, c.team, c.etaMin, c.journeyType],
    );
  }
  for (const d of doctors) {
    await pool.query('INSERT INTO doctors (id,name,department,active) VALUES ($1,$2,$3,true) ON CONFLICT (id) DO UPDATE SET name=$2,department=$3', [d.id, d.name, d.department]);
  }
  // Slots: DO NOTHING on conflict so redeploys never wipe live booked_count / status.
  for (const s of slots) {
    await pool.query(
      "INSERT INTO slots (id,doctor_id,label,start_at,capacity,booked_count,status) VALUES ($1,$2,$3,$4,$5,0,'open') ON CONFLICT (id) DO NOTHING",
      [s.id, s.doctorId, s.label, s.startAt, s.capacity],
    );
  }
}

// CLI: `node src/db/migrate.js` (pathToFileURL handles spaces in the path correctly)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config } = await import('../config.js');
  if (!config.databaseUrl) {
    console.error('DATABASE_URL not set — nothing to migrate.');
    process.exit(1);
  }
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await runMigrations(pool);
    console.log('migrations + config seed OK');
    await pool.end();
  } catch (e) {
    console.error('MIGRATION FAILED:', e.message);
    process.exit(1);
  }
}
