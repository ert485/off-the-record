// Orders the walk-through stream. The rule is deliberately simple, because
// order is a form of editorial framing (see "Clustering and the stream"):
//
// 1. Themes go in order of total reactions, most first.
// 2. Inside a theme, groups (distinct thoughts) go in order of reactions.
// 3. With 15 or fewer groups in total, every group is shown. Otherwise each
//    theme shows its top 3 groups and the last one carries "+N more like this".
// Near-duplicates inside a group are never shown separately: "+N similar".
// Two people grieving the same thing from opposite sides share one group, the
// way Priam and Achilles shared one tent.

export const SHOW_ALL_MAX = 15;
export const PER_THEME = 3;

// themes: [{ id, groups: [{ id, cardCount }] }] (only visible groups, cardCount > 0)
// reactionCounts: Map(groupId -> number)
// Returns [{ groupId, themeId, similar, moreInTheme }]
export function buildStream(themes, reactionCounts) {
  const count = (g) => reactionCounts.get(g.id) ?? 0;
  const ordered = themes
    .map((t) => ({
      ...t,
      groups: [...t.groups].sort((a, b) => count(b) - count(a) || b.cardCount - a.cardCount || a.id - b.id),
      total: t.groups.reduce((n, g) => n + count(g), 0),
    }))
    .filter((t) => t.groups.length > 0)
    .sort((a, b) => b.total - a.total || b.groups.length - a.groups.length || a.id - b.id);

  const totalGroups = ordered.reduce((n, t) => n + t.groups.length, 0);
  const showAll = totalGroups <= SHOW_ALL_MAX;
  const stream = [];
  for (const t of ordered) {
    const shown = showAll ? t.groups : t.groups.slice(0, PER_THEME);
    const leftover = t.groups.slice(shown.length).reduce((n, g) => n + g.cardCount, 0);
    shown.forEach((g, i) => {
      stream.push({
        groupId: g.id,
        themeId: t.id,
        similar: g.cardCount - 1,
        moreInTheme: i === shown.length - 1 ? leftover : 0,
      });
    });
  }
  return stream;
}
