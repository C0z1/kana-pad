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

// Due cards first (most overdue first), then unseen items up to `newLeft`.
// `entries` are { key, ... } in curriculum order.
export function queue(entries, cards, now = new Date(), newLeft = NEW_PER_DAY) {
  const due = entries
    .filter(e => cards[e.key] && Date.parse(cards[e.key].due) <= now.getTime())
    .sort((a, b) => Date.parse(cards[a.key].due) - Date.parse(cards[b.key].due));
  const fresh = entries.filter(e => !cards[e.key]).slice(0, Math.max(0, newLeft));
  return [...due, ...fresh];
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
