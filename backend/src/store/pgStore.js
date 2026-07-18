// Postgres implementation of the Store interface (async). Same surface as memoryStore, so the
// engine/services/API are identical. The no-double-booking guarantee uses a real transaction +
// SELECT ... FOR UPDATE row lock (tryHoldSlot). `pg` is imported dynamically so it is only required
// when DATABASE_URL is set (tests + memory runs stay dependency-free).

import { SlotUnavailableError } from '../errors.js';
import { runMigrations } from '../db/migrate.js';

const numOrNull = (v) => (v == null ? null : Number(v));
const idOrNull = (v) => (v == null ? null : String(v));

const toPatient = (r) => (r ? { id: r.wa_phone, waPhone: r.wa_phone, name: r.name, lang: r.lang, notes: r.notes } : null);
const toUser = (r) => (r ? { id: r.id, name: r.name, login: r.login, role: r.role, teamId: r.team_id, passwordHash: r.password_hash, phone: r.phone, hours: r.hours, doctorId: r.doctor_id, onLeave: r.on_leave === true, active: r.active } : null);
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
    async listPatients() {
      const { rows } = await q('SELECT * FROM patients ORDER BY created_at DESC');
      return rows.map(toPatient);
    },
    async updatePatient(waPhone, patch) {
      const { rows } = await q('UPDATE patients SET notes=COALESCE($2,notes), name=COALESCE($3,name) WHERE wa_phone=$1 RETURNING *', [waPhone, patch.notes ?? null, patch.name ?? null]);
      return toPatient(rows[0]);
    },
    async addPatientRecord(waPhone, record) {
      const { rows } = await q('INSERT INTO patient_records (wa_phone, kind, note, author, at) VALUES ($1,$2,$3,$4,$5) RETURNING *', [waPhone, record.kind ?? 'note', record.note ?? '', record.author ?? 'staff', Date.now()]);
      const r = rows[0];
      return { id: String(r.id), waPhone: r.wa_phone, kind: r.kind, note: r.note, author: r.author, at: numOrNull(r.at) };
    },
    async listPatientRecords(waPhone) {
      const { rows } = await q('SELECT * FROM patient_records WHERE wa_phone=$1 ORDER BY at DESC', [waPhone]);
      return rows.map((r) => ({ id: String(r.id), waPhone: r.wa_phone, kind: r.kind, note: r.note, author: r.author, at: numOrNull(r.at) }));
    },

    // ---- users ----
    async addUser(user) {
      const id = user.id || `user_${Math.random().toString(36).slice(2, 10)}`;
      const { rows } = await q(
        `INSERT INTO users (id, name, login, role, team_id, password_hash, phone, hours, doctor_id, on_leave, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id, user.name, user.login, user.role, user.teamId ?? null, user.passwordHash ?? null, user.phone ?? null, user.hours ?? null, user.doctorId ?? null, user.onLeave ?? false, user.active ?? true],
      );
      return toUser(rows[0]);
    },
    async getUser(id) {
      const { rows } = await q('SELECT * FROM users WHERE id=$1', [id]);
      return toUser(rows[0]);
    },
    async updateUser(id, patch) {
      const { rows } = await q(
        'UPDATE users SET name=COALESCE($2,name), team_id=COALESCE($3,team_id), role=COALESCE($4,role), phone=COALESCE($5,phone), hours=COALESCE($6,hours), on_leave=COALESCE($7,on_leave), active=COALESCE($8,active), password_hash=COALESCE($9,password_hash), doctor_id=COALESCE($10,doctor_id) WHERE id=$1 RETURNING *',
        [id, patch.name ?? null, patch.teamId ?? null, patch.role ?? null, patch.phone ?? null, patch.hours ?? null, patch.onLeave ?? null, patch.active ?? null, patch.passwordHash ?? null, patch.doctorId ?? null],
      );
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
    async getShift(userId, date) {
      const { rows } = await q('SELECT * FROM shifts WHERE user_id=$1 AND date=$2', [userId, date]);
      const r = rows[0];
      return r ? { id: String(r.id), userId: r.user_id, date: r.date, startTime: r.start_time, endTime: r.end_time, weeklyLeaveDay: r.weekly_leave_day, at: numOrNull(r.at) } : null;
    },
    async addShift(shift) {
      const { rows } = await q(
        `INSERT INTO shifts (user_id,date,start_time,end_time,weekly_leave_day,at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id,date) DO UPDATE SET start_time=$3,end_time=$4,weekly_leave_day=$5,at=$6 RETURNING *`,
        [shift.userId, shift.date, shift.startTime, shift.endTime, shift.weeklyLeaveDay, Date.now()],
      );
      const r = rows[0];
      return { id: String(r.id), userId: r.user_id, date: r.date, startTime: r.start_time, endTime: r.end_time, weeklyLeaveDay: r.weekly_leave_day, at: numOrNull(r.at) };
    },
    async listShifts(userId) {
      const { rows } = await q('SELECT * FROM shifts WHERE user_id=$1 ORDER BY date DESC', [userId]);
      return rows.map((r) => ({ id: String(r.id), userId: r.user_id, date: r.date, startTime: r.start_time, endTime: r.end_time, weeklyLeaveDay: r.weekly_leave_day, at: numOrNull(r.at) }));
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
    async listSlotsByDoctor(doctorId) {
      const { rows } = await q('SELECT * FROM slots WHERE doctor_id=$1 ORDER BY start_at', [doctorId]);
      return rows.map(toSlot);
    },
    async addDoctor(doc) {
      const id = doc.id || `doc_${Math.random().toString(36).slice(2, 9)}`;
      const { rows } = await q('INSERT INTO doctors (id,name,department,active) VALUES ($1,$2,$3,true) ON CONFLICT (id) DO UPDATE SET name=$2, department=$3 RETURNING *', [id, doc.name, doc.department]);
      return toDoctor(rows[0]);
    },
    async updateDoctor(id, patch) {
      const { rows } = await q('UPDATE doctors SET name=COALESCE($2,name), department=COALESCE($3,department), active=COALESCE($4,active) WHERE id=$1 RETURNING *', [id, patch.name ?? null, patch.department ?? null, patch.active ?? null]);
      return toDoctor(rows[0]);
    },
    async addSlot(slot) {
      const id = slot.id || `slot_${Math.random().toString(36).slice(2, 9)}`;
      const { rows } = await q("INSERT INTO slots (id,doctor_id,label,start_at,capacity,booked_count,status) VALUES ($1,$2,$3,$4,$5,0,'open') RETURNING *", [id, slot.doctorId, slot.label, slot.startAt ?? null, slot.capacity ?? 1]);
      return toSlot(rows[0]);
    },
    async updateSlot(id, patch) {
      const { rows } = await q('UPDATE slots SET label=COALESCE($2,label), capacity=COALESCE($3,capacity), status=COALESCE($4,status) WHERE id=$1 RETURNING *', [id, patch.label ?? null, patch.capacity ?? null, patch.status ?? null]);
      return toSlot(rows[0]);
    },
    async deleteSlot(id) {
      const { rows } = await q('SELECT booked_count FROM slots WHERE id=$1', [id]);
      if (!rows[0]) return { ok: false, reason: 'not found' };
      if (rows[0].booked_count > 0) return { ok: false, reason: 'has bookings' };
      await q('DELETE FROM slots WHERE id=$1', [id]);
      return { ok: true };
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
