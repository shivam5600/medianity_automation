# Medinity Connect — Logins

**Panel:** https://medinity-connect.onrender.com
_(Use this link. On the login screen you can show/hide the password, and "Forgot password" tells you to contact the admin.)_

| Role | Login ID | Password | What they can do |
|---|---|---|---|
| **Super Admin** | `admin@medinity.local` | `medinity@123` | Everything. See every staff member's credentials + working details. **Lock / unlock** any account and **reset any password**. Add/edit doctors + staff, overwrite slots. |
| **Hospital** | `hospital@medinity.local` | `hospital@123` | Full admin: dashboard, all ticket boards, bookings, setup. |
| **Front Desk** | `frontdesk@medinity.local` | `front@123` | Front-desk tickets + the **bookings queue** (confirm / reschedule / cancel appointments, send PDF confirmation). |
| **Housekeeping** | `housekeeping@medinity.local` | `house@123` | Housekeeping ticket board (kanban). |
| **Doctor** | `dr.sharma@medinity.local` | `doctor@123` | Doctor self-portal: **My availability** (calendar slot builder) and **My appointments**. |

## Before sharing with the team

1. Log in as **Super Admin** first.
2. Go to **Staff** and **reset each password** to something private (the ones above are demo defaults).
3. Share the new password with each person directly.

## Notes

- **First login of the day** (front desk / housekeeping) asks the person to confirm their working hours + weekly off day (IST). This drives the workforce view.
- **Doctors** are routed straight to their own portal after login.
- Everything works today on a **mock WhatsApp adapter** so you can demo the full panel. Real patient messages start flowing only after the WhatsApp go-live steps in `DEPLOY.md` (Meta business verification + `WA_*` creds + approved templates).

_Medinity · Nextgrow © 2026_
</content>
