// Journey engine — a persisted per-user state machine over WhatsApp.
//
// Root flow: language -> (confirm/capture name) -> menu -> hand off to a journey.
// Mobile is captured automatically (it IS the WhatsApp number). Name is captured once (confirm the
// WhatsApp profile name, or type it — no digits allowed) and then reused across every journey.
//
// Cross-cutting behaviours:
//   * restart  — "restart"/"menu"/"मेनू" or a Restart button resets to the menu anytime.
//   * support  — "help"/"support" or the "Talk to our team" menu option hands off to a human:
//                creates a Front-Desk support case, shares the contact number, alerts staff
//                (staff_alert event), and PAUSES the bot ('with_agent') so an admin can reply.
//                Live two-way admin replies from the portal are the next leg; every inbound is
//                already logged (store.messages) as that inbox's foundation.
//   * resume   — a returning user mid-journey is offered "Resume / Start over".
//   * expiry   — after SESSION_TTL_MS the session is dropped and the user starts fresh.
//
// Inbound (normalised by the transport layer): { waPhone, kind:'text'|'interactive'|'image',
//   text?, replyId?, media?, profileName?, now? }. handle() returns { session, replies }.

import { t, hasKey } from '../i18n.js';
import { JOURNEYS } from './index.js';
import { SESSION_TTL_MS } from './helpers.js';
import { createSupportCase } from '../services/cases.js';

const SUPPORT_PHONE = '+91 94540 99331';

const LANG_OPTIONS = [
  { id: 'lang_en', title: 'English' },
  { id: 'lang_hi', title: 'हिंदी / Hindi' },
];
const nameConfirmOptions = (lang) => [
  { id: 'name_yes', title: t(lang, 'name_yes') },
  { id: 'name_no', title: t(lang, 'name_no') },
];
const menuOptions = (lang) => [
  { id: 'menu_appointment', title: t(lang, 'menu_appointment') },
  { id: 'menu_complaint', title: t(lang, 'menu_complaint') },
  { id: 'menu_support', title: t(lang, 'menu_support') },
];
const resumeOptions = (lang) => [
  { id: 'resume_continue', title: t(lang, 'resume_continue') },
  { id: 'resume_restart', title: t(lang, 'resume_restart') },
];

const GREETINGS = ['hi', 'hii', 'hello', 'hey', 'start', 'namaste', 'नमस्ते'];
const RESTART_WORDS = ['restart', 'reset', 'menu', 'मेनू', 'मेन्यू'];
const SUPPORT_WORDS = ['help', 'support', 'agent', 'helpline', 'मदद', 'सहायता'];

const isValidName = (s) => {
  const n = (s || '').trim();
  return n.length >= 2 && !/\d/.test(n);
};

export function newSession(store, waPhone, now) {
  const patient = store.getPatient(waPhone);
  // A returning patient whose language we already know skips straight to the menu (afterLanguage
  // still re-checks that we have their name).
  const step = patient?.lang ? 'menu' : 'language';
  return session(waPhone, 'root', step, patient?.lang ?? null, now);
}

function session(waPhone, journey, step, lang, now) {
  return { waPhone, journey, step, lang, state: {}, lastActivityAt: now, expiresAt: now + SESSION_TTL_MS };
}

export function handle(deps, inbound) {
  const { store } = deps;
  const now = inbound.now ?? Date.now();
  const waPhone = inbound.waPhone;

  store.addMessage({
    waPhone,
    direction: 'in',
    body: inbound.text ?? `[${inbound.kind}]`,
    replyId: inbound.replyId ?? null,
  });

  let sess = store.getSession(waPhone);
  const expired = sess && sess.expiresAt && now > sess.expiresAt;

  // New or expired session: prompt the first step, do NOT consume this message as input.
  if (!sess || expired) {
    sess = newSession(store, waPhone, now);
    const ctx = makeCtx(deps, sess, inbound, now);
    if (sess.step === 'menu') afterLanguage(ctx);
    else promptLanguage(ctx);
    return finish(deps, ctx);
  }

  const ctx = makeCtx(deps, sess, inbound, now);

  // Global restart.
  if (isRestart(inbound)) {
    const fresh = session(waPhone, 'root', sess.lang ? 'menu' : 'language', sess.lang, now);
    fresh.state._profileName = sess.state._profileName;
    ctx.session = fresh;
    ctx.say('restarted');
    if (fresh.step === 'menu') afterLanguage(ctx);
    else promptLanguage(ctx);
    return finish(deps, ctx);
  }

  // Global support handoff (once past name/language capture).
  if (isSupport(inbound) && sess.lang && sess.step !== 'with_agent') {
    startSupport(ctx);
    return finish(deps, ctx);
  }

  // Resume offer: a greeting arriving mid-journey.
  if (isGreeting(inbound) && sess.journey !== 'root') {
    sess.state._resume = { journey: sess.journey, step: sess.step };
    sess.journey = 'root';
    sess.step = 'resume_offer';
    promptResume(ctx);
    return finish(deps, ctx);
  }

  if (sess.journey === 'root') {
    handleRoot(ctx);
  } else {
    ctx.journey = JOURNEYS[sess.journey];
    ctx.journey.steps[sess.step].handle(ctx);
  }
  return finish(deps, ctx);
}

// ---- root step handling ----

function handleRoot(ctx) {
  const s = ctx.session;

  if (s.step === 'language') {
    const opt = resolve(ctx.inbound, LANG_OPTIONS);
    if (!opt) {
      ctx.say('invalid_input');
      return promptLanguage(ctx);
    }
    s.lang = opt.id === 'lang_hi' ? 'hi' : 'en';
    ctx.store.upsertPatient({ waPhone: s.waPhone, lang: s.lang });
    ctx.say('language_set');
    return afterLanguage(ctx);
  }

  if (s.step === 'name_confirm') {
    const opt = resolve(ctx.inbound, nameConfirmOptions(s.lang));
    if (!opt) {
      ctx.say('invalid_input');
      return promptNameConfirm(ctx);
    }
    if (opt.id === 'name_yes') {
      saveName(ctx, s.state._pendingName);
      return promptMenu(ctx);
    }
    return promptNameEntry(ctx);
  }

  if (s.step === 'name_entry') {
    const text = (ctx.inbound.text || '').trim();
    if (!isValidName(text)) {
      ctx.say('name_invalid');
      return promptNameEntry(ctx);
    }
    saveName(ctx, text);
    return promptMenu(ctx);
  }

  if (s.step === 'menu') {
    const opt = resolve(ctx.inbound, menuOptions(s.lang));
    if (!opt) {
      ctx.say('invalid_input');
      return promptMenu(ctx);
    }
    if (opt.id === 'menu_complaint') return startJourney(ctx, 'complaint');
    if (opt.id === 'menu_support') return startSupport(ctx);
    return startJourney(ctx, 'appointment');
  }

  if (s.step === 'resume_offer') {
    const opt = resolve(ctx.inbound, resumeOptions(s.lang));
    if (!opt) {
      ctx.say('invalid_input');
      return promptResume(ctx);
    }
    if (opt.id === 'resume_continue') {
      const r = s.state._resume || {};
      delete s.state._resume;
      s.journey = r.journey;
      s.step = r.step;
      ctx.journey = JOURNEYS[s.journey];
      return ctx.journey.steps[s.step].prompt(ctx);
    }
    s.journey = 'root';
    s.state = { _profileName: s.state._profileName };
    ctx.say('restarted');
    return promptMenu(ctx);
  }

  // 'with_agent': the bot is paused for a human. Stay quiet — inbound is already logged for the
  // portal inbox. "menu"/"restart" (handled globally) brings the patient back to the bot.
  if (s.step === 'with_agent') {
    return;
  }
}

// Decide what comes after language is known: capture the name if we don't have it, else the menu.
function afterLanguage(ctx) {
  const patient = ctx.store.getPatient(ctx.session.waPhone);
  if (patient?.name) return promptMenu(ctx);
  const profileName = ctx.session.state._profileName;
  // Only offer to confirm the WhatsApp profile name if it is itself a valid (digit-free) name.
  if (profileName && isValidName(profileName)) return promptNameConfirm(ctx, profileName);
  return promptNameEntry(ctx);
}

function startJourney(ctx, name) {
  const s = ctx.session;
  s.journey = name;
  ctx.journey = JOURNEYS[name];
  s.step = ctx.journey.firstStep;
  ctx.journey.steps[s.step].prompt(ctx);
}

function startSupport(ctx) {
  const s = ctx.session;
  const patient = ctx.store.upsertPatient({ waPhone: s.waPhone, lang: s.lang });
  const c = createSupportCase(ctx.store, { patient, message: ctx.inbound.text || '' });
  ctx.say('support_created', { vars: { no: c.humanNo, phone: SUPPORT_PHONE } });
  s.journey = 'root';
  s.step = 'with_agent';
}

function saveName(ctx, name) {
  ctx.store.upsertPatient({ waPhone: ctx.session.waPhone, name, lang: ctx.session.lang });
}

function promptLanguage(ctx) {
  ctx.session.journey = 'root';
  ctx.session.step = 'language';
  ctx.say('choose_language', { buttons: LANG_OPTIONS });
}
function promptNameConfirm(ctx, name) {
  if (name) ctx.session.state._pendingName = name;
  ctx.session.journey = 'root';
  ctx.session.step = 'name_confirm';
  ctx.say('name_confirm', { vars: { name: ctx.session.state._pendingName }, buttons: nameConfirmOptions(ctx.session.lang) });
}
function promptNameEntry(ctx) {
  ctx.session.journey = 'root';
  ctx.session.step = 'name_entry';
  ctx.say('name_ask');
}
function promptMenu(ctx) {
  ctx.session.journey = 'root';
  ctx.session.step = 'menu';
  ctx.say('menu_prompt', { buttons: menuOptions(ctx.session.lang) });
}
function promptResume(ctx) {
  ctx.say('resume_prompt', { buttons: resumeOptions(ctx.session.lang) });
}

// ---- context + plumbing ----

function makeCtx(deps, sess, inbound, now) {
  if (inbound.profileName) sess.state._profileName = inbound.profileName;
  const replies = [];
  const ctx = {
    store: deps.store,
    adapter: deps.adapter,
    session: sess,
    inbound,
    now,
    replies,
    journey: null,
    _end: false,
    say(keyOrText, opts = {}) {
      const lang = sess.lang || 'en';
      const body = hasKey(keyOrText) ? t(lang, keyOrText, opts.vars || {}) : keyOrText;
      replies.push({
        kind: opts.buttons ? 'buttons' : opts.list ? 'list' : 'text',
        body,
        buttons: opts.buttons || null,
        sections: opts.list || null,
      });
    },
    endSession() {
      ctx._end = true;
    },
  };
  return ctx;
}

function finish(deps, ctx) {
  const { store, adapter } = deps;
  const waPhone = ctx.session.waPhone;
  for (const r of ctx.replies) {
    adapter.send(waPhone, r);
    store.addMessage({ waPhone, direction: 'out', body: r.body });
  }
  if (ctx._end) {
    store.deleteSession(waPhone);
  } else {
    ctx.session.lastActivityAt = ctx.now;
    ctx.session.expiresAt = ctx.now + SESSION_TTL_MS;
    store.saveSession(ctx.session);
  }
  return { session: ctx.session, replies: ctx.replies };
}

// ---- inbound helpers ----

function resolve(inbound, options) {
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

function isRestart(inbound) {
  if (inbound.replyId === 'cmd_restart') return true;
  return RESTART_WORDS.includes((inbound.text || '').trim().toLowerCase());
}
function isGreeting(inbound) {
  return GREETINGS.includes((inbound.text || '').trim().toLowerCase());
}
function isSupport(inbound) {
  if (inbound.replyId === 'menu_support') return true;
  return SUPPORT_WORDS.includes((inbound.text || '').trim().toLowerCase());
}
