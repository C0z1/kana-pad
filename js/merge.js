// Merges two copies of the progress (this device and the cloud), so studying on two devices
// never loses answers: each card keeps its most recent review, counters keep the highest value.
// Both sides are backups already checked by readBackup(); preferences stay those of `local`.

const at = c => Date.parse(c.last_review ?? c.due) || 0;
const maxPair = (a, b) => (a && b ? [Math.max(a[0], b[0]), Math.max(a[1], b[1])] : a ?? b);

function byKey(a = {}, b = {}, pick) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}

export function mergeProgress(local, remote) {
  if (!remote) return local;
  const examKey = x => `${x.d}|${x.right}|${x.total}`;
  const exams = [...new Map([...(remote.exams ?? []), ...(local.exams ?? [])].map(x => [examKey(x), x])).values()]
    .sort((x, y) => x.d.localeCompare(y.d)).slice(-20);
  return {
    stats: byKey(local.stats, remote.stats, maxPair),
    cards: byKey(local.cards, remote.cards, (x, y) => (at(y) > at(x) || (at(y) === at(x) && y.reps > x.reps) ? y : x)),
    history: byKey(local.history, remote.history, (x, y) => {
      const out = { ...x };
      for (const k of ["reviews", "correct", "answers", "fresh"]) if (x[k] !== undefined || y[k] !== undefined) out[k] = Math.max(x[k] ?? 0, y[k] ?? 0);
      return out;
    }),
    exams,
    stories: byKey(local.stories, remote.stories, (x, y) => (y.right > x.right ? y : x)),
    kinds: byKey(local.kinds, remote.kinds, maxPair),
    prefs: local.prefs,
  };
}

// True when merging brought something this device didn't have (then it must be applied here).
export const changed = (before, after) => JSON.stringify(before) !== JSON.stringify(after);
