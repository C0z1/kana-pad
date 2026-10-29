// Retos rápidos: Contrarreloj (60 s, as many right answers as you can) and Supervivencia (until the first miss).
// Questions come from cards already seen (kana, vocabulary, kanji) through the same options() as study;
// they never touch the FSRS calendar. One record per challenge.
import { options } from "./srs.js";

export const CHALLENGES = {
  time: { name: "Contrarreloj", seconds: 60 },
  survival: { name: "Supervivencia" },
};
// Fewer seen cards than this and the questions would repeat too much: the pool falls back to kana.
export const MIN_POOL = 12;

// entries: [{ item, deck }]. Distractors come from the same deck, so they look alike; `prev` is not repeated.
export function challengeQuestion(entries, rng = Math.random, prev = null) {
  const pool = entries.length > 1 && prev ? entries.filter(e => e.item !== prev) : entries;
  const { item, deck } = pool[Math.floor(rng() * pool.length)];
  return { item, prompt: item.q, answer: item.a, opts: options(deck.items, item, "a", rng), ask: deck.kind === "kana" ? "¿Cómo se lee?" : "¿Qué significa?" };
}

// Whether the run ends after this answer: a miss ends Supervivencia; Contrarreloj ends on the clock only.
export const runOver = (id, ok, secondsLeft = Infinity) => (id === "survival" ? !ok : secondsLeft <= 0);

// Score = right answers. Returns the records to save, the best score and whether this run beat it.
export function recordRun(records, id, score) {
  const best = records?.[id] ?? 0;
  const isNew = score > best;
  return { records: isNew ? { ...records, [id]: score } : { ...records }, best: Math.max(best, score), isNew };
}

// Reto del día: the same 10 questions all day. The pool is fixed (the decks of the student's level, not the
// cards seen so far) so studying during the day doesn't change the questions; the rng is seeded by the date.
export const DAILY_QUESTIONS = 10;
export function seededRng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function dailyQuestions(entries, dateKey, n = DAILY_QUESTIONS) {
  const rng = seededRng(dateKey), qs = [];
  for (let i = 0; i < n; i++) qs.push(challengeQuestion(entries, rng, qs.at(-1)?.item));
  return qs;
}
