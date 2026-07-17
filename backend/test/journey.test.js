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
async function toMenu(send, p, { profileName = 'Ravi Kumar', lang = 'lang_en' } = {}) {
  await send(p, { ...txt('hi'), profileName });
  await send(p, btn(lang));
  await send(p, btn('name_yes'));
}

test('name is captured up front by confirming the WhatsApp profile name', async () => {
  const { store, send } = setup();
  const p = '+9101';
  assert.match(last(await send(p, { ...txt('hi'), profileName: 'Ravi Kumar' })), /Welcome to Medinity/);
  assert.match(last(await send(p, btn('lang_en'))), /name as Ravi Kumar/);
  assert.match(last(await send(p, btn('name_yes'))), /help you today/);
  assert.equal((await store.getPatient(p)).name, 'Ravi Kumar');
  assert.equal((await store.getPatient(p)).waPhone, p);
});

test('name entry rejects a value containing digits, accepts a clean name', async () => {
  const { store, send } = setup();
  const p = '+9102';
  await send(p, txt('hi'));
  assert.match(last(await send(p, btn('lang_en'))), /type your full name/);
  assert.match(bodies(await send(p, txt('R2D2'))), /valid name/);
  assert.match(last(await send(p, txt('Aman Verma'))), /help you today/);
  assert.equal((await store.getPatient(p)).name, 'Aman Verma');
});

test('a WhatsApp profile name with digits is not offered for confirm; we ask to type one', async () => {
  const { send } = setup();
  const p = '+9103';
  await send(p, { ...txt('hi'), profileName: 'Bed 12' });
  assert.match(last(await send(p, btn('lang_en'))), /type your full name/);
});

test('complaint journey: menu -> category -> room -> desc -> photo -> routed ticket', async () => {
  const { store, send } = setup();
  const p = '+9111';
  await toMenu(send, p);
  assert.match(last(await send(p, btn('menu_complaint'))), /problem about/);
  assert.match(last(await send(p, btn('cat_cleanliness'))), /room or bed/);
  assert.match(last(await send(p, txt('204'))), /describe the problem/);
  assert.match(last(await send(p, txt('Bed is dirty'))), /Send a photo/);

  const done = await send(p, txt('skip'));
  assert.match(last(done), /Housekeeping/);
  assert.match(last(done), /30/);

  const c = (await store.listCases())[0];
  assert.equal(c.type, 'complaint');
  assert.equal(c.teamId, 'housekeeping');
  assert.equal(c.roomBed, '204');
  assert.equal(c.etaMin, 30);
  assert.equal((await store.getPatient(p)).name, 'Ravi Kumar');
  assert.equal(await store.getSession(p), null);
});

test('language chosen up front carries through the whole journey (Hindi)', async () => {
  const { send } = setup();
  const p = '+9122';
  await send(p, { ...txt('hi'), profileName: 'Sunita' });
  assert.match(last(await send(p, btn('lang_hi'))), /Sunita/);
  assert.match(last(await send(p, btn('name_yes'))), /मदद/);
  assert.match(last(await send(p, btn('menu_complaint'))), /समस्या/);
});

test('restart resets to the menu from anywhere', async () => {
  const { store, send } = setup();
  const p = '+9133';
  await toMenu(send, p);
  await send(p, btn('menu_complaint'));
  await send(p, btn('cat_food'));

  assert.match(last(await send(p, txt('restart'))), /help you today/);
  const s = await store.getSession(p);
  assert.equal(s.step, 'menu');
  assert.equal(s.state.categoryId, undefined);
});

test('resume: a greeting mid-journey offers Resume / Start over', async () => {
  const { send } = setup();
  const p = '+9144';
  await toMenu(send, p);
  await send(p, btn('menu_complaint'));
  await send(p, btn('cat_cleanliness'));

  assert.match(last(await send(p, txt('hi'))), /unfinished|Resume/i);
  assert.match(last(await send(p, btn('resume_continue'))), /room or bed/);
});

test('resume: choosing Start over goes back to the menu', async () => {
  const { send } = setup();
  const p = '+9155';
  await toMenu(send, p);
  await send(p, btn('menu_complaint'));
  await send(p, btn('cat_cleanliness'));
  await send(p, txt('hi'));
  assert.match(last(await send(p, btn('resume_restart'))), /help you today/);
});

test('an expired session starts fresh (returning patient keeps language + name)', async () => {
  const { store, send } = setup();
  const p = '+9166';
  await toMenu(send, p);
  await send(p, btn('menu_complaint'));
  await send(p, btn('cat_cleanliness'));

  const r = await send(p, txt('anything'), NOW + DAY + 1);
  assert.match(last(r), /help you today/);
  assert.equal((await store.getSession(p)).step, 'menu');
});

test('appointment journey: department -> doctor -> slot -> held booking (name not re-asked)', async () => {
  const { store, send } = setup();
  const p = '+9177';
  await toMenu(send, p);
  assert.match(last(await send(p, btn('menu_appointment'))), /department/);
  assert.match(last(await send(p, txt('1'))), /doctor/);
  assert.match(last(await send(p, txt('1'))), /time slot/);
  assert.match(last(await send(p, txt('1'))), /pending/);

  const bookings = await store.listBookings();
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].status, 'held');
  assert.equal((await store.getSlot('slot_1')).status, 'full');
  const c = (await store.listCases()).find((x) => x.type === 'enquiry');
  assert.ok(c && c.bookingId);
});

test('support handoff (menu): creates a support case, shares contact, alerts staff, pauses bot', async () => {
  const { store, send } = setup();
  const p = '+9188';
  await toMenu(send, p);

  const r = await send(p, btn('menu_support'));
  assert.match(last(r), /support team/i);
  assert.match(last(r), /94540/);

  const c = (await store.listCases()).find((x) => x.type === 'support');
  assert.ok(c);
  assert.equal((await store.getSession(p)).step, 'with_agent');
  assert.equal((await store.listCaseEvents(c.id)).filter((e) => e.type === 'staff_alert').length, 1);

  const quiet = await send(p, txt('are you there?'));
  assert.equal(quiet.replies.length, 0);
  assert.ok((await store.listMessages(p)).some((m) => m.direction === 'in' && m.body === 'are you there?'));

  assert.match(last(await send(p, txt('menu'))), /help you today/);
});

test('global "help" during a journey triggers the support handoff', async () => {
  const { store, send } = setup();
  const p = '+9199';
  await toMenu(send, p);
  await send(p, btn('menu_complaint'));
  assert.match(last(await send(p, txt('help'))), /support team/i);
  assert.ok((await store.listCases()).some((x) => x.type === 'support'));
});
