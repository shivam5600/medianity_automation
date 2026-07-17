// Category -> team + ETA resolution. Routing is data-driven (categories carry their team + ETA),
// so reorganising teams or changing ETAs is a config edit, never a code change.

export function routeCategory(store, categoryId) {
  const category = store.getCategory(categoryId);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);
  const team = store.getTeam(category.team);
  if (!team) throw new Error(`Category ${categoryId} points at missing team ${category.team}`);
  return { category, team, etaMin: category.etaMin };
}
