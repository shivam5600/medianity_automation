# Medinity Connect

WhatsApp-first patient ecosystem for **Medinity Hospital, Lucknow** — one system, two journeys:

- **Appointment / enquiry** → doctor → real slot → atomic hold → front-desk confirms (lead-gen)
- **Complaint** ("bed is dirty" + photo) → auto-routed ticket → ETA → resolution → 1–5 rating

Patients act entirely inside **WhatsApp** (Meta Cloud API). Staff work an **admin panel** (the team
inbox). **n8n** runs the timed flows (reminders, SLA escalation, central-Sheet sync). All outbound to
patients is **admin-triggered or scheduled** — nothing sends silently.

See the design/spec: `~/.claude/plans/hi-i-need-resilient-floyd.md`.

## Layout

```
17. Medinity Connect/
  backend/            Node (ESM) API + WhatsApp webhook + journey engine
    src/
      config.js       creds.local.json / env loader (portable, gitignored secrets)
      i18n.js         Hindi/English strings
      data/seed.js    default teams, categories, doctors, slots
      store/          persistence — memoryStore (tests) + pgStore (prod, TODO)
      services/       routing · cases · booking (atomic hold) · messaging
      whatsapp/       mockAdapter (tests) + cloudApi (Meta, TODO)
      journey/        engine (state machine, restart/resume) + journeys/
    test/             node:test suites (no deps, run today)
  admin/              React panel (TODO — Phase 1)
  n8n/                flow exports (TODO — Phase 2)
```

## Status

**Done + verified (16 passing tests):**
- Journey engine: language → **name capture** (confirm WhatsApp profile name / type it, no digits) →
  menu → journey, with **restart**, **resume-or-start-over**, and 24h **session expiry**.
- Mobile captured automatically (the WhatsApp number); name captured once, reused across journeys.
- **Complaint journey** → auto-routed case + ETA + confirmation.
- **Appointment journey** → atomic slot **hold** (no double-booking) → "pending, front desk confirms".
- **Support handoff** → contact number + backend `staff_alert` + bot pauses for a human.
- Bilingual (Hindi/English) — whole journey runs in the language chosen up front.
- **Live layer built:** Meta Cloud API adapter (`whatsapp/cloudApi.js`), webhook server (`server.js`),
  portable config (`config.js`). Deploy + add creds = live on a Meta **test number**.

**Next legs (in order):**
1. **Durable Postgres store** — makes the store async (small refactor, guarded by the test suite).
2. **Admin panel** (React, JR-admin style: clean UI + dashboard — leads, open/resolved, ETA/SLA,
   ratings, by-team, pending bookings). Also the **portal ↔ WhatsApp two-way inbox** (admin reads/replies).
3. **n8n timed flows** — appointment reminders, SLA escalation, feedback reminder, central-Sheet sync.

## Flow reference

`docs/Medinity_Connect_Flows.xlsx` — one tab per flow with the exact bot question at each step in
**English + Hindi**, input type, validation, routing, plus teams/ETAs and the admin metrics.

## Run the tests (today, zero setup)

```bash
cd "0. MY explore/Nextgrow/2. Medianity/backend"
node --test          # 16 tests, no npm install needed (built-in runner + in-memory store + mock adapter)
```

## Run it live (once Meta creds exist)

```bash
cd backend
cp creds.local.example.json creds.local.json   # fill in WA_PHONE_NUMBER_ID, WA_TOKEN, WA_VERIFY_TOKEN
npm install && npm start                        # webhook on :8098
```
Expose the URL (Render, or ngrok for local), register `<url>/webhook` + the verify token in Meta,
and message the bot's number. Meta's **free test number** works with no business verification.
