// Category -> team + ETA resolution (data-driven; reorganising teams/ETAs is a config edit).

export async function routeCategory(store, categoryId) {
  const category = await store.getCategory(categoryId);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);
  const team = await store.getTeam(category.team);
  if (!team) throw new Error(`Category ${categoryId} points at missing team ${category.team}`);
  return { category, team, etaMin: category.etaMin };
}
