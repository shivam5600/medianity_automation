import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore } from '../src/store/memoryStore.js';
import { createMockAdapter } from '../src/whatsapp/mockAdapter.js';
import { handle } from '../src/journey/engine.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const store = createMemoryStore();
  const adapter = createMockAdapter();
  const deps = { store, adapter };
  const send = (waPhone, msg, now = NOW) => handle(deps, { waPhone, now, ...msg });
  return { store, adapter, send };
}

const last = (r) => r.replies[r.replies.length - 1].body;
const bodies = (r) => r.replies.map((x) => x.body).join(' ');
const btn = (id) => ({ kind: 'interactive', replyId: id });
const txt = (text) => ({ kind: 'text', text });

// Common intro: greeting (with a WhatsApp profile name) -> language -> confirm name -> at the menu.
function toMenu(send, p, { profileName = 'Ravi Kumar', lang = 'lang_en' } = {}) {
  send(p, { ...txt('hi'), profileName });
  send(p, btn(lang));
  send(p, btn('name_yes'));
}

test('name is captured up front by confirming the WhatsApp profile name', () => {
  const { store, send } = setup();
  const p = '+9101';
  assert.match(last(send(p, { ...txt('hi'), profileName: 'Ravi Kumar' })), /Welcome to Medinity/);
  assert.match(last(send(p, btn('lang_en'))), /name as Ravi Kumar/);
  assert.match(last(send(p, btn('name_yes'))), /help you today/);
  assert.equal(store.getPatient(p).name, 'Ravi Kumar');
  assert.equal(store.getPatient(p).waPhone, p); // mobile captured automatically
});

test('name entry rejects a value containing digits, accepts a clean name', () => {
  const { store, send } = setup();
  const p = '+9102';
  send(p, txt('hi')); // no profile name -> ask to type it
  assert.match(last(send(p, btn('lang_en'))), /type your full name/);
  assert.match(bodies(send(p, txt('R2D2'))), /valid name/); // rejected (has digits), re-asked
  assert.match(last(send(p, txt('Aman Verma'))), /help you today/);
  assert.equal(store.getPatient(p).name, 'Aman Verma');
});

test('a WhatsApp profile name with digits is not offered for confirm; we ask to type one', () => {
  const { send } = setup();
  const p = '+9103';
  send(p, { ...txt('hi'), profileName: 'Bed 12' });
  assert.match(last(send(p, btn('lang_en'))), /type your full name/);
});

test('complaint journey: menu -> category -> room -> desc -> photo -> routed ticket', () => {
  const { store, send } = setup();
  const p = '+9111';
  toMenu(send, p);
  assert.match(last(send(p, btn('menu_complaint'))), /problem about/);
  assert.match(last(send(p, btn('cat_cleanliness'))), /room or bed/);
  assert.match(last(send(p, txt('204'))), /describe the problem/);
  assert.match(last(send(p, txt('Bed is dirty'))), /Send a photo/);

  const done = send(p, txt('skip'));
  assert.match(last(done), /Housekeeping/);
  assert.match(last(done), /30/);

  const c = store.listCases()[0];
  assert.equal(c.type, 'complaint');
  assert.equal(c.teamId, 'housekeeping');
  assert.equal(c.roomBed, '204');
  assert.equal(c.etaMin, 30);
  assert.equal(store.getPatient(p).name, 'Ravi Kumar'); // name flowed in, never re-asked
  assert.equal(store.getSession(p), null);
});

test('language chosen up front carries through the whole journey (Hindi)', () => {
  const { send } = setup();
  const p = '+9122';
  send(p, { ...txt('hi'), profileName: 'Sunita' });
  assert.match(last(send(p, btn('lang_hi'))), /Sunita/); // name confirm in Hindi
  assert.match(last(send(p, btn('name_yes'))), /मदद/); // menu in Hindi
  assert.match(last(send(p, btn('menu_complaint'))), /समस्या/); // category in Hindi
});

test('restart resets to the menu from anywhere', () => {
  const { store, send } = setup();
  const p = '+9133';
  toMenu(send, p);
  send(p, btn('menu_complaint'));
  send(p, btn('cat_food')); // mid-journey

  assert.match(last(send(p, txt('restart'))), /help you today/);
  const s = store.getSession(p);
  assert.equal(s.step, 'menu');
  assert.equal(s.state.categoryId, undefined);
});

test('resume: a greeting mid-journey offers Resume / Start over', () => {
  const { send } = setup();
  const p = '+9144';
  toMenu(send, p);
  send(p, btn('menu_complaint'));
  send(p, btn('cat_cleanliness')); // at "room"

  assert.match(last(send(p, txt('hi'))), /unfinished|Resume/i);
  assert.match(last(send(p, btn('resume_continue'))), /room or bed/);
});

test('resume: choosing Start over goes back to the menu', () => {
  const { send } = setup();
  const p = '+9155';
  toMenu(send, p);
  send(p, btn('menu_complaint'));
  send(p, btn('cat_cleanliness'));
  send(p, txt('hi'));
  assert.match(last(send(p, btn('resume_restart'))), /help you today/);
});

test('an expired session starts fresh (returning patient keeps language + name)', () => {
  const { store, send } = setup();
  const p = '+9166';
  toMenu(send, p);
  send(p, btn('menu_complaint'));
  send(p, btn('cat_cleanliness')); // mid-journey

  const r = send(p, txt('anything'), NOW + DAY + 1);
  assert.match(last(r), /help you today/); // straight to menu, no language/name re-ask
  assert.equal(store.getSession(p).step, 'menu');
});

test('appointment journey: department -> doctor -> slot -> held booking (name not re-asked)', () => {
  const { store, send } = setup();
  const p = '+9177';
  toMenu(send, p);
  assert.match(last(send(p, btn('menu_appointment'))), /department/);
  assert.match(last(send(p, txt('1'))), /doctor/); // Orthopaedics
  assert.match(last(send(p, txt('1'))), /time slot/); // Dr. A. Sharma
  assert.match(last(send(p, txt('1'))), /pending/); // books straight after slot

  const bookings = store.listBookings();
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].status, 'held');
  assert.equal(store.getSlot('slot_1').status, 'full');
  const c = store.listCases().find((x) => x.type === 'enquiry');
  assert.ok(c && c.bookingId);
});

test('support handoff (menu): creates a support case, shares contact, alerts staff, pauses bot', () => {
  const { store, send } = setup();
  const p = '+9188';
  toMenu(send, p);

  const r = send(p, btn('menu_support'));
  assert.match(last(r), /support team/i);
  assert.match(last(r), /94540/); // contact number surfaced

  const c = store.listCases().find((x) => x.type === 'support');
  assert.ok(c);
  assert.equal(store.getSession(p).step, 'with_agent');
  assert.equal(store.listCaseEvents(c.id).filter((e) => e.type === 'staff_alert').length, 1);

  // Bot stays quiet while a human handles it, but the inbound is logged for the portal inbox.
  const quiet = send(p, txt('are you there?'));
  assert.equal(quiet.replies.length, 0);
  assert.ok(store.listMessages(p).some((m) => m.direction === 'in' && m.body === 'are you there?'));

  // "menu" brings them back to the bot.
  assert.match(last(send(p, txt('menu'))), /help you today/);
});

test('global "help" during a journey triggers the support handoff', () => {
  const { store, send } = setup();
  const p = '+9199';
  toMenu(send, p);
  send(p, btn('menu_complaint')); // mid-journey
  assert.match(last(send(p, txt('help'))), /support team/i);
  assert.ok(store.listCases().some((x) => x.type === 'support'));
});
