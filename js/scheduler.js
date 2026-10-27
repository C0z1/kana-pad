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

// A stored card must carry every FSRS field, or ts-fsrs throws and the session freezes.
const isNum = v => typeof v === "number" && Number.isFinite(v) && v >= 0;
export function validCard(c) {
  return !!c && typeof c === "object" &&
    typeof c.due === "string" && !Number.isNaN(Date.parse(c.due)) &&
    [c.stability, c.difficulty, c.elapsed_days, c.scheduled_days, c.reps, c.lapses, c.learning_steps].every(isNum) &&
    [0, 1, 2, 3].includes(c.state) &&
    (c.last_review === undefined || (typeof c.last_review === "string" && !Number.isNaN(Date.parse(c.last_review))));
}

// Drops invalid cards (they come back as new) instead of letting one bad entry break the queue.
export function sanitizeCards(cards) {
  const out = {};
  if (cards && typeof cards === "object") for (const [k, c] of Object.entries(cards)) if (validCard(c)) out[k] = c;
  return out;
}

// Returns the next stored card after answering. `stored` is undefined for a new item.
export function grade(stored, ok, ms = 0, now = new Date()) {
  const rating = ratingFor(ok, ms);
  try {
    const card = stored ? revive(stored) : createEmptyCard(now);
    return serialize(scheduler.next(card, now, rating).card);
  } catch {
    return serialize(scheduler.next(createEmptyCard(now), now, rating).card);
  }
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

// The study day ends at 4:00 (like Anki), so a late-night session still counts as "today".
export const DAY_START_HOUR = 4;
export const studyDay = (now = new Date()) => new Date(now.getTime() - DAY_START_HOUR * 3600e3).toLocaleDateString("sv");
export function dayEnd(now = new Date()) {
  const end = new Date(now);
  end.setHours(DAY_START_HOUR, 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end;
}

// Overdue cards (most overdue first), then today's new cards shuffled (so kana can't be
// guessed from あいうえお order), then cards due within LEARN_AHEAD_MS (just-failed ones).
// Review cards (state 2) count as due for the whole study day; learning cards keep their minute.
// `entries` are { key, ... } in curriculum order.
export function queue(entries, cards, now = new Date(), newLeft = NEW_PER_DAY, seed = "") {
  const t = now.getTime(), end = dayEnd(now).getTime(), dueAt = e => Date.parse(cards[e.key].due);
  const seen = entries.filter(e => cards[e.key]).sort((a, b) => dueAt(a) - dueAt(b));
  const due = seen.filter(e => dueAt(e) <= (cards[e.key].state === 2 ? end : t));
  const soon = seen.filter(e => !due.includes(e) && dueAt(e) <= t + LEARN_AHEAD_MS);
  const rng = seededRng(seed);
  const fresh = entries.filter(e => !cards[e.key]).slice(0, Math.max(0, newLeft))
    .map(e => [rng(), e]).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
  return [...due, ...fresh, ...soon];
}

// Brake: with a big backlog or weak retention on mature cards, take fewer (or no) new cards.
// `history` only counts answers to cards that were already in review (state 2), so cards
// taught minutes ago don't drag retention down.
export const BRAKE_PENDING = 100, BRAKE_STOP = 200, BRAKE_RETENTION = 0.75, BRAKE_MIN_REVIEWS = 50, BRAKE_NEW = 5;
export function newCardsToday(duePending, history, today) {
  if (duePending > BRAKE_STOP) return 0;
  const recent = Object.entries(history).filter(([d]) => d < today).sort().slice(-3).map(([, h]) => h);
  const reviews = recent.reduce((s, h) => s + h.reviews, 0);
  const correct = recent.reduce((s, h) => s + h.correct, 0);
  const lowRetention = reviews >= BRAKE_MIN_REVIEWS && correct / reviews < BRAKE_RETENTION;
  return duePending > BRAKE_PENDING || lowRetention ? BRAKE_NEW : NEW_PER_DAY;
}

// Breather: a card just shown doesn't come back until 2 other cards or 60 s have passed.
// `recent` is [{ key, t, taught }] of the cards shown, oldest first. Returns null when every
// candidate is resting (the caller tells the student to come back in a minute).
export const BREATHER_CARDS = 2, BREATHER_MS = 60000;
export function pickNext(q, recent, now, isNew) {
  const resting = key => recent.slice(-BREATHER_CARDS).some(r => r.key === key && now - r.t < BREATHER_MS);
  const ready = q.filter(e => !resting(e.key));
  if (!ready.length) return null;
  // At most one lesson in a row while there are cards to ask.
  if (isNew(ready[0]) && recent.at(-1)?.taught) return ready.find(e => !isNew(e)) ?? ready[0];
  return ready[0];
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
