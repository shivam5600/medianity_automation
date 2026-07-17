// In-memory store — the reference implementation of the Store interface. Used by tests and local
// dev (no DB, no cost). The production pgStore implements the SAME interface against Postgres, so the
// journey engine / services never change. Because Node is single-threaded, the sequential mutations
// here are naturally atomic; pgStore reproduces that guarantee across processes with SELECT ... FOR
// UPDATE (see services/booking.js).

import { defaultSeed, departmentsFrom } from '../data/seed.js';

export function createMemoryStore(seed = defaultSeed()) {
  const teams = new Map(seed.teams.map((x) => [x.id, x]));
  const categories = new Map(seed.categories.map((x) => [x.id, x]));
  const doctors = new Map(seed.doctors.map((x) => [x.id, x]));
  const slots = new Map(seed.slots.map((x) => [x.id, { ...x }]));

  const sessions = new Map(); // waPhone -> session
  const patients = new Map(); // waPhone -> patient
  const users = new Map(); // id -> staff user (admin panel)
  const cases = new Map(); // id -> case
  const events = []; // { caseId, ... }
  const attachments = []; // { caseId, ... }
  const bookings = new Map(); // id -> booking
  const messages = []; // outbound/inbound log

  let caseSeq = 1041; // human_no starts at #1042
  let idSeq = 0;
  const nextId = (p) => `${p}_${++idSeq}`;

  return {
    // ---- sessions ----
    getSession: (waPhone) => sessions.get(waPhone) || null,
    saveSession(session) {
      sessions.set(session.waPhone, session);
      return session;
    },
    deleteSession: (waPhone) => sessions.delete(waPhone),

    // ---- patients ----
    upsertPatient({ waPhone, name, lang }) {
      const existing = patients.get(waPhone) || { id: nextId('pat'), waPhone };
      const patient = {
        ...existing,
        name: name ?? existing.name,
        lang: lang ?? existing.lang,
      };
      patients.set(waPhone, patient);
      return patient;
    },
    getPatient: (waPhone) => patients.get(waPhone) || null,

    // ---- staff users (admin panel) ----
    addUser(user) {
      const row = { id: nextId('user'), active: true, ...user };
      users.set(row.id, row);
      return row;
    },
    getUser: (id) => users.get(id) || null,
    getUserByLogin: (login) =>
      [...users.values()].find((u) => u.login.toLowerCase() === String(login).toLowerCase()) || null,
    listUsers: () => [...users.values()],

    // ---- config ----
    listTeams: () => [...teams.values()],
    getTeam: (id) => teams.get(id) || null,
    listComplaintCategories: () =>
      [...categories.values()].filter((c) => c.journeyType === 'complaint'),
    getCategory: (id) => categories.get(id) || null,
    listDoctors: () => [...doctors.values()],
    listDepartments: () => departmentsFrom([...doctors.values()]),
    listDoctorsByDept: (dept) => [...doctors.values()].filter((d) => d.department === dept),
    getDoctor: (id) => doctors.get(id) || null,
    listOpenSlots: (doctorId) =>
      [...slots.values()].filter((s) => s.doctorId === doctorId && s.status === 'open'),
    getSlot: (id) => slots.get(id) || null,
    _setSlot(slot) {
      slots.set(slot.id, slot);
      return slot;
    },

    // ---- cases ----
    createCase(data) {
      const id = nextId('case');
      const humanNo = `#${++caseSeq}`;
      const now = Date.now();
      const c = {
        id,
        humanNo,
        status: 'new',
        createdAt: now,
        resolvedAt: null,
        rating: null,
        feedback: null,
        assigneeId: null,
        ...data,
      };
      cases.set(id, c);
      return c;
    },
    getCase: (id) => cases.get(id) || null,
    updateCase(id, patch) {
      const c = cases.get(id);
      if (!c) return null;
      const updated = { ...c, ...patch };
      cases.set(id, updated);
      return updated;
    },
    listCases: (filter = {}) =>
      [...cases.values()].filter((c) =>
        Object.entries(filter).every(([k, v]) => c[k] === v),
      ),
    addCaseEvent(caseId, event) {
      const row = { id: nextId('evt'), caseId, at: Date.now(), ...event };
      events.push(row);
      return row;
    },
    listCaseEvents: (caseId) => events.filter((e) => e.caseId === caseId),
    addAttachment(caseId, att) {
      const row = { id: nextId('att'), caseId, at: Date.now(), ...att };
      attachments.push(row);
      return row;
    },
    listAttachments: (caseId) => attachments.filter((a) => a.caseId === caseId),

    // ---- bookings ----
    addBooking(booking) {
      const id = nextId('book');
      const row = { id, createdAt: Date.now(), ...booking };
      bookings.set(id, row);
      return row;
    },
    getBooking: (id) => bookings.get(id) || null,
    updateBooking(id, patch) {
      const b = bookings.get(id);
      if (!b) return null;
      const updated = { ...b, ...patch };
      bookings.set(id, updated);
      return updated;
    },
    listBookings: () => [...bookings.values()],

    // ---- messages (WhatsApp log) ----
    addMessage(msg) {
      const row = { id: nextId('msg'), at: Date.now(), ...msg };
      messages.push(row);
      return row;
    },
    listMessages: (waPhone) =>
      waPhone ? messages.filter((m) => m.waPhone === waPhone) : [...messages],
  };
}
