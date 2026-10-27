// Daily review queue on top of FSRS (ts-fsrs). Cards are stored as plain JSON so they can
// live in IndexedDB and in export files.
import { fsrs, createEmptyCard, Rating } from "./vendor/ts-fsrs.mjs";

export const NEW_PER_DAY = 15;
export const SLOW_MS = 8000; // a correct answer slower than this counts as "Hard"

const scheduler = fsrs({ request_retention: 0.9 });

const revive = c => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });
const serialize = c => ({ ...c, due: c.due.toISOString(), last_review: c.last_review ? c.last_review.toISOString() : undefined });

export function ratingFor(ok, ms) {
  if (!ok) return Rating.Again;
  return ms > SLOW_MS ? Rating.Hard : Rating.Good;
}

// Returns the next stored card after answering. `stored` is undefined for a new item.
export function grade(stored, ok, ms = 0, now = new Date()) {
  const card = stored ? revive(stored) : createEmptyCard(now);
  return serialize(scheduler.next(card, now, ratingFor(ok, ms)).card);
}

export const LEARN_AHEAD_MS = 20 * 60 * 1000; // like Anki: cards failed minutes ago come back this session

// Small seeded PRNG so a day's new cards keep the same shuffled order between calls.
export function seededRng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Overdue cards (most overdue first), then today's new cards shuffled (so kana can't be
// guessed from あいうえお order), then cards due within LEARN_AHEAD_MS (just-failed ones).
// `entries` are { key, ... } in curriculum order.
export function queue(entries, cards, now = new Date(), newLeft = NEW_PER_DAY, seed = "") {
  const t = now.getTime(), dueAt = e => Date.parse(cards[e.key].due);
  const seen = entries.filter(e => cards[e.key]).sort((a, b) => dueAt(a) - dueAt(b));
  const due = seen.filter(e => dueAt(e) <= t);
  const soon = seen.filter(e => dueAt(e) > t && dueAt(e) <= t + LEARN_AHEAD_MS);
  const rng = seededRng(seed);
  const fresh = entries.filter(e => !cards[e.key]).slice(0, Math.max(0, newLeft))
    .map(e => [rng(), e]).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
  return [...due, ...fresh, ...soon];
}

// Merges lists by taking weights[i] items from list i per turn, so new cards mix
// vocabulary, grammar and kanji instead of exhausting one deck before the next.
export function interleave(lists, weights) {
  const pos = lists.map(() => 0), out = [];
  while (lists.some((l, i) => pos[i] < l.length)) {
    lists.forEach((l, i) => {
      out.push(...l.slice(pos[i], pos[i] + weights[i]));
      pos[i] += weights[i];
    });
  }
  return out;
}

// Earliest future due date among seen cards, or null.
export function nextDue(cards, now = new Date()) {
  let min = Infinity;
  for (const c of Object.values(cards)) {
    const t = Date.parse(c.due);
    if (t > now.getTime() && t < min) min = t;
  }
  return min === Infinity ? null : new Date(min);
}
