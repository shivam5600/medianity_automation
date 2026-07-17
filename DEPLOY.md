# Deploying Medinity Connect

The backend is **one zero-dependency Node process** that serves the admin panel, the admin API, and
the WhatsApp webhook. Because it holds live conversation state in memory and must stay always-on for
the webhook, it belongs on a **persistent host** (Render), not on Vercel's stateless serverless model.

## Recommended topology (free)

```
Render  →  medinity-connect  (Node service: panel + /api + /webhook)   ← always-on, webhook lives here
Vercel  →  (optional) the static panel only, pointed at the Render API URL
Meta    →  webhook = https://medinity-connect.onrender.com/webhook
```

## 1. Git repo (personal GitHub)

```bash
cd "0. MY explore/Nextgrow/2. Medianity"
git init && git add -A && git commit -m "Medinity Connect: WhatsApp patient ecosystem (backend + admin panel)"
git branch -M main
git remote add origin https://github.com/<your-username>/medinity-connect.git   # create this empty repo first
git push -u origin main
```

## 2. Backend on Render

- New → **Blueprint** → pick this repo (it reads `render.yaml`), or New → Web Service:
  - Root directory `backend`, Start command `node src/server.js`, Health check `/health`.
- Set env vars: `WA_PHONE_NUMBER_ID`, `WA_TOKEN`, `WA_VERIFY_TOKEN` (any string), optionally `WA_APP_SECRET`.
- Deploy → note the URL, e.g. `https://medinity-connect.onrender.com`.
- The panel is then live at that URL root; the webhook at `/webhook`.

## 3. (Optional) Panel on Vercel

Only if you want the panel on your Vercel domain instead of the Render URL:
- Deploy `backend/public` as a static project (no build).
- In `backend/public/index.html`, before `app.js`, add:
  `<script>window.MEDINITY_API='https://medinity-connect.onrender.com'</script>`
- The backend already sends permissive CORS for `/api`.

## 4. Connect WhatsApp (Meta)

- Meta app → WhatsApp → **Configuration** → Webhook: URL `https://.../webhook`, verify token = your
  `WA_VERIFY_TOKEN`; subscribe to the `messages` field.
- Use Meta's **free test number** (instant) to try it, or the hospital number **9471621193** once the
  WhatsApp Business Account + business verification are done.

## Note on persistence

The in-memory store resets on restart. Before real patients, do the **Postgres leg** (durable store +
migrations) so tickets/bookings survive restarts and multiple instances.
