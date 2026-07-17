// Dashboard metrics computed from the store (leads, tickets, SLA, ratings, by-team).

import { isOpen, isSlaBreached } from '../services/cases.js';

export async function computeMetrics(store) {
  const [cases, bookings, teams] = await Promise.all([store.listCases(), store.listBookings(), store.listTeams()]);

  const complaints = cases.filter((c) => c.type === 'complaint');
  const leads = cases.filter((c) => c.type === 'enquiry');
  const support = cases.filter((c) => c.type === 'support');
  const resolved = cases.filter((c) => c.status === 'resolved' || c.status === 'closed');
  const openComplaints = complaints.filter(isOpen);
  const breaches = complaints.filter((c) => isSlaBreached(c));
  const pendingBookings = bookings.filter((b) => b.status === 'held' || b.status === 'pending');

  const ratings = cases.map((c) => c.rating).filter((r) => r != null);
  const avgRating = ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null;

  const resTimes = resolved.filter((c) => c.resolvedAt).map((c) => c.resolvedAt - c.createdAt);
  const avgResolutionMin = resTimes.length
    ? Math.round(resTimes.reduce((a, b) => a + b, 0) / resTimes.length / 60000)
    : null;

  const byTeam = teams.map((t) => {
    const tc = cases.filter((c) => c.teamId === t.id);
    return {
      team: t.name,
      total: tc.length,
      open: tc.filter(isOpen).length,
      resolved: tc.filter((c) => c.status === 'resolved' || c.status === 'closed').length,
    };
  });

  return {
    leads: leads.length,
    openTickets: openComplaints.length,
    resolved: resolved.length,
    pendingBookings: pendingBookings.length,
    slaBreaches: breaches.length,
    supportHandoffs: support.length,
    avgRating,
    avgResolutionMin,
    byTeam,
  };
}
