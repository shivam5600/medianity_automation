# Medinity Connect

WhatsApp-first patient ecosystem for **Medinity Hospital, Lucknow** — one system, two journeys, one
admin panel for the whole hospital's front-of-house + support operation.

- **Appointment / enquiry** → doctor → real slot → atomic hold → front-desk confirms (lead-gen)
- **Complaint** ("bed is dirty" + photo) → auto-routed ticket → ETA → resolution → 1-10 rating

Patients act entirely inside **WhatsApp** (Meta Cloud API). Staff work an **admin panel** (the team
inbox + workforce console). All outbound to patients is **admin-triggered or scheduled** — nothing
sends silently.

Design/spec: `~/.claude/plans/hi-i-need-resilient-floyd.md`.

## Layout

```
2. Medianity/
  backend/            Node (ESM, zero-dep) API + WhatsApp webhook + journey engine + panel
    src/
      config.js       creds.local.json / env loader (portable, gitignored secrets)
      server.js       http server: /webhook + /api + serves the panel (reads POST/PUT/PATCH bodies)
      i18n.js         Hindi/English strings
      data/seed.js    default teams, categories, doctors, slots
      store/          persistence — memoryStore (tests/demo) + pgStore (Neon/Postgres)
      db/migrations/  idempotent fail-loud SQL (001_init.sql)
      services/       routing · cases · booking (atomic hold) · messaging · pdf (zero-dep generator)
      whatsapp/       mockAdapter (tests) + cloudApi (Meta: send, sendDocument, downloadMedia)
      journey/        engine (state machine, restart/resume) + journeys/
      api/            routes.js (the whole admin API) · seedAdmin.js (logins + demo) · auth.js (HMAC+scrypt)
      jobs.js         in-process scheduler (hold-expiry, SLA flag, reminders)
    public/           the admin panel — vanilla-JS SPA (index.html, app.js, styles.css), no framework
    test/             node:test suites (22 passing, no deps)
  docs/               Medinity_Connect_Flows.xlsx (per-flow bot script EN+Hindi)
```

## Logins (4 roles, seeded)

Show/hide password on the login bar · **Forgot password** → "contact your admin" message · locked
accounts are blocked at login with a clear message.

| Role | Login | Password | Sees |
|---|---|---|---|
| **Super Admin** | `admin@medinity.local` | `medinity@123` | Everything · staff credentials + working details · lock/unlock + reset password |
| **Hospital** | `hospital@medinity.local` | `hospital@123` | Full admin (dashboard, all boards, setup) |
| **Front Desk** (team_lead) | `frontdesk@medinity.local` | `front@123` | Own team's tickets + bookings queue |
| **Housekeeping** (team_lead) | `housekeeping@medinity.local` | `house@123` | Own team's tickets |
| **Doctor** | `dr.sharma@medinity.local` | `doctor@123` | Doctor self-portal: My availability · My appointments |

> These are demo/seed credentials. Change them (or the seed) before real use. Super admin can lock,
> unlock, reset password, and edit any user's role/team/hours from the Staff console — JR-style.

## Status — what's built and verified

**Patient side (WhatsApp journey engine):**
- Language → **name capture** (confirm WhatsApp profile name or type it, no digits) → menu → journey,
  with **restart**, **resume-or-start-over**, and 24h **session expiry**.
- Mobile captured automatically (the WhatsApp number); name captured once, reused across journeys.
- **Complaint journey** → auto-routed case + ETA + confirmation, optional **photo** upload.
- **Appointment journey** → atomic slot **hold** (no double-booking) → "pending, front desk confirms".
- **Support handoff** → contact number + backend `staff_alert` + bot pauses for a human.
- **Feedback** → 1-10 rating captured once a ticket is closed (does not hijack menu numbers).
- Bilingual (Hindi/English) — the whole journey runs in the language chosen up front.

**Admin panel (vanilla-JS SPA, JR-style, world-class-ecosystem build):**
- **Dashboard** — grouped KPI cards (readability), the **leads → appointment → visited → revisit**
  funnel, and trend lines.
- **Tickets kanban** — drag-drop New → Assigned → In-progress → Resolved; SLA breach flagged.
- **Full-page details** (not popups) for tickets, bookings, patients, doctors, staff — each with an
  **events timeline**, **two-way chat** to the patient's WhatsApp, and **real-time status** via live
  polling. Ticket detail shows uploaded images (e.g. the demo "dirty bed").
- **Bookings** — confirm / reschedule / cancel; **PDF confirmation** generated (zero-dep) and sent
  over WhatsApp.
- **Patient log book** — directory + full history + staff notes per patient.
- **Doctor console** — calendar slot builder (date → hours → slots tick, presets + custom, "off"
  message when a slot is closed), avg rating, on-leave signal.
- **Staff / team directory** — workforce, working hours, weekly leave, ratings, active/on-leave
  signals; **lock / unlock** account, **change / reset password** (super admin), self-edit guarded
  (cannot lock your own account).
- **Staff daily check-in** — first login each day (IST) confirms working hours + weekly leave day.
- Login **show/hide password** + **forgot-password → contact-admin**; one-line footer
  "Medinity · Nextgrow © 2026"; theme-aware, no horizontal overflow at any pane width.

**Backend + data:**
- **Durable Postgres store** — async store + `pgStore` (transactions + `SELECT … FOR UPDATE`),
  verified against a live **Neon** DB incl. concurrent no-double-booking. Falls back to in-memory when
  `DATABASE_URL` is unset. Idempotent, fail-loud migrations (`npm run migrate`).
- **Scheduler** (`jobs.js`, in-process): expire slot holds, flag SLA breaches, feedback + appointment
  reminders — each idempotent via case events.
- **Auth** — HMAC-signed bearer tokens + scrypt password hashing; RBAC (`super_admin`, `hospital`,
  `team_lead`, `agent`, `doctor`; `isAdmin = super_admin || hospital`).
- **Live WhatsApp layer** — Meta Cloud API adapter (`whatsapp/cloudApi.js`) with `sendDocument`
  (PDF over WhatsApp) + `downloadMedia`; deploy + add `WA_*` creds = live on a Meta test number.

## Live (split deploy)

- **Backend** (panel + API + webhook + scheduler) → Render: https://medinity-connect.onrender.com
  (autoDeploy on push; Render can lag, so deploys are also triggered via the Render API).
- **Panel** → Vercel static snapshot, pointed at the Render API via `window.MEDINITY_API`.
- **DB** → Neon (Postgres, us-east); backend co-located in Virginia.
- **Repo** → github.com/shivam5600/medianity_automation (`main`).
- Notes: Render free tier sleeps after ~15min idle (first message slow — Render Starter $7/mo for
  always-on). For production, co-locate Render + Neon in Singapore/ap-south and set `SEED_DEMO=0`.

**Remaining to go live for real patients:** Meta business verification + `WA_*` creds + approved
templates (see DEPLOY.md). Vercel short-URL refresh needs a Vercel Personal Access Token.

## Skills used (build provenance)

This product was built with these Claude Code skills — kept here so the next session knows the
conventions each one locked in:

| Skill | Where it shows up |
|---|---|
| **superpowers:brainstorming** | Turned the raw idea into the locked design (channel = official WhatsApp, one-Case-two-journeys, real-slots-front-desk-confirms, free-tier topology). Output is the spec at `~/.claude/plans/hi-i-need-resilient-floyd.md`. |
| **ui-ux-kumar** | House rules enforced across the whole panel: **no em-dash / double-hyphen** in any user-visible text (empty cells render "·"), **theme-aware both directions**, **zero horizontal overflow at every pane width**, equal splits use `minmax(0, 1fr)`, and **verify-live before done**. Drove the dashboard grouping, kanban, calendar slot builder, and full-page-detail layouts. |
| **webapp-testing** | Playwright drive-scripts that verified the panel end to end against a live local server — login show/hide + forgot, kanban drag, lock/unlock + locked-login block, calendar slot ticking, full-page details with live poll. Screenshots saved to the scratchpad each pass. |
| **xlsx** | Built `docs/Medinity_Connect_Flows.xlsx` — one tab per flow with the exact bot question at each step in **English + Hindi**, input type, validation, routing, plus teams/ETAs and the admin metrics. |

## Flow reference

`docs/Medinity_Connect_Flows.xlsx` — one tab per flow with the exact bot question at each step in
**English + Hindi**, input type, validation, routing, plus teams/ETAs and the admin metrics.

## Run the tests (today, zero setup)

```bash
cd "0. MY explore/Nextgrow/2. Medianity/backend"
node --test          # 22 tests, no npm install (built-in runner + in-memory store + mock adapter)
```

## Run it live (once Meta creds exist)

```bash
cd backend
cp creds.local.example.json creds.local.json   # fill in WA_PHONE_NUMBER_ID, WA_TOKEN, WA_VERIFY_TOKEN
# optional: set DATABASE_URL for durable Postgres (Neon); omit to use the in-memory demo store
npm start                                       # panel + API + webhook on :8098
```
Expose the URL (Render, or ngrok for local), register `<url>/webhook` + the verify token in Meta,
and message the bot's number. Meta's **free test number** works with no business verification.
</content>
</invoke>
