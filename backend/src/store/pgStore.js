// Postgres implementation of the Store interface (async). Same surface as memoryStore, so the
// engine/services/API are identical. The no-double-booking guarantee uses a real transaction +
// SELECT ... FOR UPDATE row lock (tryHoldSlot). `pg` is imported dynamically so it is only required
// when DATABASE_URL is set (tests + memory runs stay dependency-free).

import { SlotUnavailableError } from '../errors.js';
import { runMigrations } from '../db/migrate.js';

const numOrNull = (v) => (v == null ? null : Number(v));
const idOrNull = (v) => (v == null ? null : String(v));

const toPatient = (r) => (r ? { id: r.wa_phone, waPhone: r.wa_phone, name: r.name, lang: r.lang } : null);
const toUser = (r) => (r ? { id: r.id, name: r.name, login: r.login, role: r.role, teamId: r.team_id, passwordHash: r.password_hash, active: r.active } : null);
const toSession = (r) => (r ? { waPhone: r.wa_phone, journey: r.journey, step: r.step, lang: r.lang, state: r.state || {}, lastActivityAt: numOrNull(r.last_activity_at), expiresAt: numOrNull(r.expires_at) } : null);
const toTeam = (r) => (r ? { id: r.id, name: r.name } : null);
const toCategory = (r) => (r ? { id: r.id, en: r.en, hi: r.hi, team: r.team, etaMin: r.eta_min, journeyType: r.journey_type } : null);
const toDoctor = (r) => (r ? { id: r.id, name: r.name, department: r.department, active: r.active } : null);
const toSlot = (r) => (r ? { id: r.id, doctorId: r.doctor_id, label: r.label, startAt: r.start_at, capacity: r.capacity, bookedCount: r.booked_count, status: r.status } : null);
const toCase = (r) => (r ? { id: String(r.id), humanNo: r.human_no, type: r.type, categoryId: r.category_id, patientId: r.patient_wa, waPhone: r.patient_wa, teamId: r.team_id, assigneeId: r.assignee_id, status: r.status, roomBed: r.room_bed, description: r.description, etaMin: r.eta_min, etaAt: numOrNull(r.eta_at), slaDueAt: numOrNull(r.sla_due_at), rating: r.rating, feedback: r.feedback, bookingId: idOrNull(r.booking_id), createdAt: numOrNull(r.created_at), resolvedAt: numOrNull(r.resolved_at) } : null);
const toEvent = (r) => ({ id: String(r.id), caseId: String(r.case_id), actor: r.actor, type: r.type, payload: r.payload || {}, at: numOrNull(r.at) });
const toAttachment = (r) => ({ id: String(r.id), caseId: String(r.case_id), url: r.url, waMediaId: r.wa_media_id, kind: r.kind, at: numOrNull(r.at) });
const toBooking = (r) => (r ? { id: String(r.id), slotId: r.slot_id, doctorId: r.doctor_id, patientId: r.patient_wa, caseId: idOrNull(r.case_id), status: r.status, holdExpiresAt: numOrNull(r.hold_expires_at), cancelReason: r.cancel_reason, visitedAt: numOrNull(r.visited_at), isRevisit: r.is_revisit === true, createdAt: numOrNull(r.created_at) } : null);
const toMessage = (r) => ({ id: String(r.id), waPhone: r.wa_phone, direction: r.direction, body: r.body, replyId: r.reply_id, templateKey: r.template_key, agent: r.agent, caseId: idOrNull(r.case_id), at: numOrNull(r.at) });

const CASE_COLS = { status: 'status', resolvedAt: 'resolved_at', rating: 'rating', feedback: 'feedback', assigneeId: 'assignee_id', bookingId: 'booking_id', teamId: 'team_id', etaAt: 'eta_at', slaDueAt: 'sla_due_at', roomBed: 'room_bed', description: 'description' };
const BOOKING_COLS = { status: 'status', caseId: 'case_id', cancelReason: 'cancel_reason', visitedAt: 'visited_at', isRevisit: 'is_revisit', slotId: 'slot_id', doctorId: 'doctor_id' };
const ACTIVE = "('held','pending','confirmed')";

export async function createPgStore(connectionString) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 8 });
  const q = (text, params) => pool.query(text, params);

  async function recomputeSlot(client, slotId) {
    await client.query(
      `UPDATE slots s SET booked_count = c.n,
         status = CASE WHEN c.n >= s.capacity THEN 'full' ELSE 'open' END
       FROM (SELECT count(*) n FROM bookings WHERE slot_id=$1 AND status IN ${ACTIVE}) c
       WHERE s.id=$1`,
      [slotId],
    );
  }

  return {
    kind: 'postgres',
    async init() {
      await runMigrations(pool); // idempotent schema + config seed; fail-loud on error
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },

    // ---- sessions ----
    async getSession(waPhone) {
      const { rows } = await q('SELECT * FROM sessions WHERE wa_phone=$1', [waPhone]);
      return toSession(rows[0]);
    },
    async saveSession(s) {
      await q(
        `INSERT INTO sessions (wa_phone, journey, step, lang, state, last_activity_at, expires_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
         ON CONFLICT (wa_phone) DO UPDATE SET journey=$2, step=$3, lang=$4, state=$5::jsonb, last_activity_at=$6, expires_at=$7`,
        [s.waPhone, s.journey, s.step, s.lang, JSON.stringify(s.state || {}), s.lastActivityAt, s.expiresAt],
      );
      return s;
    },
    async deleteSession(waPhone) {
      await q('DELETE FROM sessions WHERE wa_phone=$1', [waPhone]);
    },

    // ---- patients ----
    async upsertPatient({ waPhone, name, lang }) {
      const { rows } = await q(
        `INSERT INTO patients (wa_phone, name, lang, created_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (wa_phone) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, patients.name),
           lang = COALESCE(EXCLUDED.lang, patients.lang)
         RETURNING *`,
        [waPhone, name ?? null, lang ?? null, Date.now()],
      );
      return toPatient(rows[0]);
    },
    async getPatient(waPhone) {
      const { rows } = await q('SELECT * FROM patients WHERE wa_phone=$1', [waPhone]);
      return toPatient(rows[0]);
    },

    // ---- users ----
    async addUser(user) {
      const id = user.id || `user_${Math.random().toString(36).slice(2, 10)}`;
      const { rows } = await q(
        `INSERT INTO users (id, name, login, role, team_id, password_hash, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, user.name, user.login, user.role, user.teamId ?? null, user.passwordHash ?? null, user.active ?? true],
      );
      return toUser(rows[0]);
    },
    async getUser(id) {
      const { rows } = await q('SELECT * FROM users WHERE id=$1', [id]);
      return toUser(rows[0]);
    },
    async getUserByLogin(login) {
      const { rows } = await q('SELECT * FROM users WHERE lower(login)=lower($1)', [login]);
      return toUser(rows[0]);
    },
    async listUsers() {
      const { rows } = await q('SELECT * FROM users');
      return rows.map(toUser);
    },

    // ---- config ----
    async listTeams() {
      const { rows } = await q('SELECT * FROM teams ORDER BY id');
      return rows.map(toTeam);
    },
    async getTeam(id) {
      const { rows } = await q('SELECT * FROM teams WHERE id=$1', [id]);
      return toTeam(rows[0]);
    },
    async listComplaintCategories() {
      const { rows } = await q("SELECT * FROM categories WHERE journey_type='complaint' ORDER BY id");
      return rows.map(toCategory);
    },
    async getCategory(id) {
      const { rows } = await q('SELECT * FROM categories WHERE id=$1', [id]);
      return toCategory(rows[0]);
    },
    async listDoctors() {
      const { rows } = await q('SELECT * FROM doctors');
      return rows.map(toDoctor);
    },
    async listDepartments() {
      const { rows } = await q('SELECT DISTINCT department FROM doctors ORDER BY department');
      return rows.map((r) => r.department);
    },
    async listDoctorsByDept(dept) {
      const { rows } = await q('SELECT * FROM doctors WHERE department=$1', [dept]);
      return rows.map(toDoctor);
    },
    async getDoctor(id) {
      const { rows } = await q('SELECT * FROM doctors WHERE id=$1', [id]);
      return toDoctor(rows[0]);
    },
    async listOpenSlots(doctorId) {
      const { rows } = await q("SELECT * FROM slots WHERE doctor_id=$1 AND status='open' ORDER BY start_at", [doctorId]);
      return rows.map(toSlot);
    },
    async getSlot(id) {
      const { rows } = await q('SELECT * FROM slots WHERE id=$1', [id]);
      return toSlot(rows[0]);
    },

    // ---- cases ----
    async createCase(data) {
      const { rows } = await q(
        `INSERT INTO cases (human_no, type, category_id, patient_wa, team_id, status, room_bed, description, eta_min, eta_at, sla_due_at, created_at)
         VALUES ('#'||nextval('case_human_seq'), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [data.type, data.categoryId ?? null, data.waPhone ?? data.patientId ?? null, data.teamId ?? null, data.status || 'new', data.roomBed ?? null, data.description ?? null, data.etaMin ?? null, data.etaAt ?? null, data.slaDueAt ?? null, Date.now()],
      );
      return toCase(rows[0]);
    },
    async getCase(id) {
      const { rows } = await q('SELECT * FROM cases WHERE id=$1', [id]);
      return toCase(rows[0]);
    },
    async updateCase(id, patch) {
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(patch)) {
        if (CASE_COLS[k]) {
          vals.push(v);
          sets.push(`${CASE_COLS[k]}=$${vals.length}`);
        }
      }
      if (!sets.length) return this.getCase(id);
      vals.push(id);
      const { rows } = await q(`UPDATE cases SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
      return toCase(rows[0]);
    },
    async listCases(filter = {}) {
      const wh = [];
      const vals = [];
      const MAP = { type: 'type', status: 'status', teamId: 'team_id', categoryId: 'category_id' };
      for (const [k, v] of Object.entries(filter)) {
        if (MAP[k]) {
          vals.push(v);
          wh.push(`${MAP[k]}=$${vals.length}`);
        }
      }
      const { rows } = await q(`SELECT * FROM cases ${wh.length ? 'WHERE ' + wh.join(' AND ') : ''}`, vals);
      return rows.map(toCase);
    },
    async addCaseEvent(caseId, event) {
      const { rows } = await q(
        'INSERT INTO case_events (case_id, actor, type, payload, at) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *',
        [caseId, event.actor, event.type, JSON.stringify(event.payload || {}), Date.now()],
      );
      return toEvent(rows[0]);
    },
    async listCaseEvents(caseId) {
      const { rows } = await q('SELECT * FROM case_events WHERE case_id=$1 ORDER BY at', [caseId]);
      return rows.map(toEvent);
    },
    async addAttachment(caseId, att) {
      const { rows } = await q(
        'INSERT INTO attachments (case_id, url, wa_media_id, kind, at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [caseId, att.url ?? null, att.waMediaId ?? null, att.kind ?? null, Date.now()],
      );
      return toAttachment(rows[0]);
    },
    async listAttachments(caseId) {
      const { rows } = await q('SELECT * FROM attachments WHERE case_id=$1', [caseId]);
      return rows.map(toAttachment);
    },

    // ---- bookings (atomic via transaction + row lock) ----
    async tryHoldSlot({ slotId, patient, caseId = null, holdMinutes = 10, now = Date.now() }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM slots WHERE id=$1 FOR UPDATE', [slotId]);
        const slot = rows[0];
        if (!slot || slot.status !== 'open' || slot.booked_count >= slot.capacity) {
          await client.query('ROLLBACK');
          throw new SlotUnavailableError(`Slot ${slotId} is not available`);
        }
        const bookedCount = slot.booked_count + 1;
        await client.query('UPDATE slots SET booked_count=$1, status=$2 WHERE id=$3', [bookedCount, bookedCount >= slot.capacity ? 'full' : 'open', slotId]);
        const ins = await client.query(
          `INSERT INTO bookings (slot_id, doctor_id, patient_wa, case_id, status, hold_expires_at, created_at)
           VALUES ($1,$2,$3,$4,'held',$5,$6) RETURNING *`,
          [slotId, slot.doctor_id, patient.id ?? patient.waPhone, caseId, now + holdMinutes * 60_000, Date.now()],
        );
        await client.query('COMMIT');
        return toBooking(ins.rows[0]);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async getBooking(id) {
      const { rows } = await q('SELECT * FROM bookings WHERE id=$1', [id]);
      return toBooking(rows[0]);
    },
    async rescheduleBooking(bookingId, newSlotId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bRes = await client.query('SELECT * FROM bookings WHERE id=$1', [bookingId]);
        const b = bRes.rows[0];
        if (!b) { await client.query('ROLLBACK'); return null; }
        const sRes = await client.query('SELECT * FROM slots WHERE id=$1 FOR UPDATE', [newSlotId]);
        const ns = sRes.rows[0];
        if (!ns || ns.status !== 'open' || ns.booked_count >= ns.capacity) {
          await client.query('ROLLBACK');
          throw new SlotUnavailableError(`Slot ${newSlotId} is not available`);
        }
        const nc = ns.booked_count + 1;
        await client.query('UPDATE slots SET booked_count=$1, status=$2 WHERE id=$3', [nc, nc >= ns.capacity ? 'full' : 'open', newSlotId]);
        await client.query('UPDATE bookings SET slot_id=$1, doctor_id=$2 WHERE id=$3', [newSlotId, ns.doctor_id, bookingId]);
        await recomputeSlot(client, b.slot_id); // free the old slot
        const out = await client.query('SELECT * FROM bookings WHERE id=$1', [bookingId]);
        await client.query('COMMIT');
        return toBooking(out.rows[0]);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async updateBooking(id, patch) {
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(patch)) {
        if (BOOKING_COLS[k]) {
          vals.push(v);
          sets.push(`${BOOKING_COLS[k]}=$${vals.length}`);
        }
      }
      if (!sets.length) return this.getBooking(id);
      vals.push(id);
      const { rows } = await q(`UPDATE bookings SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
      return toBooking(rows[0]);
    },
    async listBookings() {
      const { rows } = await q('SELECT * FROM bookings ORDER BY created_at DESC');
      return rows.map(toBooking);
    },
    async confirmBooking(id) {
      const { rows } = await q("UPDATE bookings SET status='confirmed' WHERE id=$1 RETURNING *", [id]);
      return toBooking(rows[0]);
    },
    async cancelBooking(id, reason = 'cancelled') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('UPDATE bookings SET status=$2, cancel_reason=$3 WHERE id=$1 RETURNING *', [id, 'cancelled', reason]);
        if (rows[0]) await recomputeSlot(client, rows[0].slot_id);
        await client.query('COMMIT');
        return toBooking(rows[0]);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async releaseExpiredHolds(now = Date.now()) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          "UPDATE bookings SET status='cancelled', cancel_reason='hold_expired' WHERE status='held' AND hold_expires_at<=$1 RETURNING slot_id",
          [now],
        );
        const slotIds = [...new Set(rows.map((r) => r.slot_id))];
        for (const sid of slotIds) await recomputeSlot(client, sid);
        await client.query('COMMIT');
        return rows.length;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },

    // ---- messages ----
    async addMessage(msg) {
      const { rows } = await q(
        'INSERT INTO messages (wa_phone, direction, body, reply_id, template_key, agent, case_id, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [msg.waPhone, msg.direction, msg.body ?? null, msg.replyId ?? null, msg.templateKey ?? null, msg.agent ?? null, msg.caseId ?? null, Date.now()],
      );
      return toMessage(rows[0]);
    },
    async listMessages(waPhone) {
      const { rows } = waPhone
        ? await q('SELECT * FROM messages WHERE wa_phone=$1 ORDER BY at', [waPhone])
        : await q('SELECT * FROM messages ORDER BY at');
      return rows.map(toMessage);
    },
  };
}
