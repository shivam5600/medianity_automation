// Dashboard metrics: KPIs + chart series over an optional date range, plus current alerts.
// Query: computeMetrics(store, { from, to }) where from/to are epoch-ms (optional; default = all time).

import { isOpen, isSlaBreached } from '../services/cases.js';

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

export async function computeMetrics(store, { from = null, to = null } = {}) {
  const [allCases, bookings, teams] = await Promise.all([store.listCases(), store.listBookings(), store.listTeams()]);
  const inRange = (ts) => ts != null && (from == null || ts >= from) && (to == null || ts <= to);

  const cases = allCases.filter((c) => inRange(c.createdAt)); // range-scoped for KPIs + charts

  const complaints = cases.filter((c) => c.type === 'complaint');
  const leads = cases.filter((c) => c.type === 'enquiry');
  const support = cases.filter((c) => c.type === 'support');
  const resolved = cases.filter((c) => c.status === 'resolved' || c.status === 'closed');
  const openComplaints = complaints.filter(isOpen);
  const breaches = complaints.filter((c) => isSlaBreached(c));

  const ratings = cases.map((c) => c.rating).filter((r) => r != null);
  const avgRating = ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null;
  const resTimes = resolved.filter((c) => c.resolvedAt).map((c) => c.resolvedAt - c.createdAt);
  const avgResolutionMin = resTimes.length ? Math.round(resTimes.reduce((a, b) => a + b, 0) / resTimes.length / 60000) : null;

  // ---- chart series ----
  const statusOrder = ['new', 'assigned', 'in_progress', 'resolved', 'closed'];
  const statusCounts = Object.fromEntries(statusOrder.map((s) => [s, cases.filter((c) => c.status === s).length]));
  const typeCounts = {
    complaint: complaints.length,
    enquiry: leads.length,
    support: support.length,
  };

  const days = {};
  for (const c of cases) {
    (days[dayKey(c.createdAt)] ||= { created: 0, resolved: 0 }).created++;
  }
  for (const c of allCases) {
    if (c.resolvedAt && inRange(c.resolvedAt)) (days[dayKey(c.resolvedAt)] ||= { created: 0, resolved: 0 }).resolved++;
  }
  const daily = Object.entries(days).sort().map(([date, v]) => ({ date, created: v.created, resolved: v.resolved }));

  const byTeam = teams.map((t) => {
    const tc = cases.filter((c) => c.teamId === t.id);
    return {
      team: t.name,
      total: tc.length,
      open: tc.filter(isOpen).length,
      resolved: tc.filter((c) => c.status === 'resolved' || c.status === 'closed').length,
    };
  });

  // ---- current alerts (NOT range-scoped; these are "act now" items) ----
  const teamName = async (id) => (id ? (await store.getTeam(id))?.name || id : '·');
  const slaAlerts = await Promise.all(
    allCases
      .filter((c) => c.type === 'complaint' && isSlaBreached(c))
      .map(async (c) => ({ id: c.id, humanNo: c.humanNo, team: await teamName(c.teamId), roomBed: c.roomBed || '·', overdueMin: Math.round((Date.now() - c.slaDueAt) / 60000) })),
  );
  const pendingBookingAlerts = await Promise.all(
    bookings
      .filter((b) => b.status === 'held' || b.status === 'pending')
      .map(async (b) => {
        const doctor = await store.getDoctor(b.doctorId);
        const slot = await store.getSlot(b.slotId);
        const lc = b.caseId ? await store.getCase(b.caseId) : null;
        const patient = lc ? await store.getPatient(lc.waPhone) : null;
        return { id: b.id, caseId: b.caseId, doctor: doctor?.name || '·', slot: slot?.label || '·', patientName: patient?.name || '·' };
      }),
  );
  const supportAlerts = allCases
    .filter((c) => c.type === 'support' && isOpen(c))
    .map((c) => ({ id: c.id, humanNo: c.humanNo, waPhone: c.waPhone }));

  return {
    range: { from, to },
    kpis: {
      leads: leads.length,
      openTickets: openComplaints.length,
      resolved: resolved.length,
      pendingBookings: pendingBookingAlerts.length,
      slaBreaches: breaches.length,
      supportHandoffs: support.length,
      avgRating,
      avgResolutionMin,
    },
    statusCounts,
    typeCounts,
    daily,
    byTeam,
    alerts: { sla: slaAlerts, bookings: pendingBookingAlerts, support: supportAlerts },
  };
}
