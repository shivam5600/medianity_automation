// In-memory store — the ASYNC reference implementation of the Store interface. Used by tests and
// local/demo runs. pgStore implements the SAME async interface against Postgres, so the engine,
// services and API never change between them.
//
// Atomicity: methods that do a read-modify-write which must be atomic (tryHoldSlot, cancelBooking,
// releaseExpiredHolds) run their whole body with NO internal `await`, so even though they are async
// the event loop cannot interleave another request mid-operation. pgStore reproduces this with a
// transaction + SELECT ... FOR UPDATE (see pgStore.js).

import { defaultSeed, departmentsFrom } from '../data/seed.js';
import { SlotUnavailableError } from '../errors.js';

export function createMemoryStore(seed = defaultSeed()) {
  const teams = new Map(seed.teams.map((x) => [x.id, x]));
  const categories = new Map(seed.categories.map((x) => [x.id, x]));
  const doctors = new Map(seed.doctors.map((x) => [x.id, x]));
  const slots = new Map(seed.slots.map((x) => [x.id, { ...x }]));

  const sessions = new Map();
  const patients = new Map();
  const users = new Map();
  const cases = new Map();
  const events = [];
  const attachments = [];
  const bookings = new Map();
  const messages = [];

  let caseSeq = 1041;
  let idSeq = 0;
  const nextId = (p) => `${p}_${++idSeq}`;

  return {
    kind: 'memory',
    async init() {},
    async close() {},

    // ---- sessions ----
    async getSession(waPhone) {
      return sessions.get(waPhone) || null;
    },
    async saveSession(session) {
      sessions.set(session.waPhone, session);
      return session;
    },
    async deleteSession(waPhone) {
      sessions.delete(waPhone);
    },

    // ---- patients ----
    async upsertPatient({ waPhone, name, lang }) {
      const existing = patients.get(waPhone) || { id: nextId('pat'), waPhone };
      const patient = { ...existing, name: name ?? existing.name, lang: lang ?? existing.lang };
      patients.set(waPhone, patient);
      return patient;
    },
    async getPatient(waPhone) {
      return patients.get(waPhone) || null;
    },

    // ---- staff users ----
    async addUser(user) {
      const row = { id: nextId('user'), active: true, ...user };
      users.set(row.id, row);
      return row;
    },
    async getUser(id) {
      return users.get(id) || null;
    },
    async getUserByLogin(login) {
      return [...users.values()].find((u) => u.login.toLowerCase() === String(login).toLowerCase()) || null;
    },
    async listUsers() {
      return [...users.values()];
    },

    // ---- config ----
    async listTeams() {
      return [...teams.values()];
    },
    async getTeam(id) {
      return teams.get(id) || null;
    },
    async listComplaintCategories() {
      return [...categories.values()].filter((c) => c.journeyType === 'complaint');
    },
    async getCategory(id) {
      return categories.get(id) || null;
    },
    async listDoctors() {
      return [...doctors.values()];
    },
    async listDepartments() {
      return departmentsFrom([...doctors.values()]);
    },
    async listDoctorsByDept(dept) {
      return [...doctors.values()].filter((d) => d.department === dept);
    },
    async getDoctor(id) {
      return doctors.get(id) || null;
    },
    async listOpenSlots(doctorId) {
      return [...slots.values()].filter((s) => s.doctorId === doctorId && s.status === 'open');
    },
    async getSlot(id) {
      return slots.get(id) || null;
    },

    // ---- cases ----
    async createCase(data) {
      const id = nextId('case');
      const c = {
        id,
        humanNo: `#${++caseSeq}`,
        status: 'new',
        createdAt: Date.now(),
        resolvedAt: null,
        rating: null,
        feedback: null,
        assigneeId: null,
        ...data,
      };
      cases.set(id, c);
      return c;
    },
    async getCase(id) {
      return cases.get(id) || null;
    },
    async updateCase(id, patch) {
      const c = cases.get(id);
      if (!c) return null;
      const updated = { ...c, ...patch };
      cases.set(id, updated);
      return updated;
    },
    async listCases(filter = {}) {
      return [...cases.values()].filter((c) => Object.entries(filter).every(([k, v]) => c[k] === v));
    },
    async addCaseEvent(caseId, event) {
      const row = { id: nextId('evt'), caseId, at: Date.now(), ...event };
      events.push(row);
      return row;
    },
    async listCaseEvents(caseId) {
      return events.filter((e) => e.caseId === caseId);
    },
    async addAttachment(caseId, att) {
      const row = { id: nextId('att'), caseId, at: Date.now(), ...att };
      attachments.push(row);
      return row;
    },
    async listAttachments(caseId) {
      return attachments.filter((a) => a.caseId === caseId);
    },

    // ---- bookings (atomic ops have NO internal await) ----
    async tryHoldSlot({ slotId, patient, caseId = null, holdMinutes = 10, now = Date.now() }) {
      const slot = slots.get(slotId);
      if (!slot || slot.status !== 'open' || slot.bookedCount >= slot.capacity) {
        throw new SlotUnavailableError(`Slot ${slotId} is not available`);
      }
      const bookedCount = slot.bookedCount + 1;
      slots.set(slotId, { ...slot, bookedCount, status: bookedCount >= slot.capacity ? 'full' : 'open' });
      const id = nextId('book');
      const row = { id, slotId, doctorId: slot.doctorId, patientId: patient.id, caseId, status: 'held', holdExpiresAt: now + holdMinutes * 60_000, createdAt: Date.now() };
      bookings.set(id, row);
      return row;
    },
    async getBooking(id) {
      return bookings.get(id) || null;
    },
    async updateBooking(id, patch) {
      const b = bookings.get(id);
      if (!b) return null;
      const updated = { ...b, ...patch };
      bookings.set(id, updated);
      return updated;
    },
    async listBookings() {
      return [...bookings.values()];
    },
    async confirmBooking(id) {
      const b = bookings.get(id);
      if (!b) return null;
      const updated = { ...b, status: 'confirmed' };
      bookings.set(id, updated);
      return updated;
    },
    async cancelBooking(id, reason = 'cancelled') {
      const b = bookings.get(id);
      if (!b) return null;
      bookings.set(id, { ...b, status: 'cancelled', cancelReason: reason });
      const slot = slots.get(b.slotId);
      if (slot) slots.set(slot.id, { ...slot, bookedCount: Math.max(0, slot.bookedCount - 1), status: 'open' });
      return bookings.get(id);
    },
    async releaseExpiredHolds(now = Date.now()) {
      let released = 0;
      for (const b of bookings.values()) {
        if (b.status === 'held' && b.holdExpiresAt <= now) {
          bookings.set(b.id, { ...b, status: 'cancelled', cancelReason: 'hold_expired' });
          const slot = slots.get(b.slotId);
          if (slot) slots.set(slot.id, { ...slot, bookedCount: Math.max(0, slot.bookedCount - 1), status: 'open' });
          released++;
        }
      }
      return released;
    },

    // ---- messages ----
    async addMessage(msg) {
      const row = { id: nextId('msg'), at: Date.now(), ...msg };
      messages.push(row);
      return row;
    },
    async listMessages(waPhone) {
      return waPhone ? messages.filter((m) => m.waPhone === waPhone) : [...messages];
    },
  };
}
