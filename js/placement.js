// Placement test: six questions per level, easiest level first. The first level the student
// doesn't pass is where new cards start; everything before it stays out of the daily review.
import { options, shuffle } from "./srs.js";

export const PER_LEVEL = 6, PASS = 5; // 5 of 6 right means the level is already known
// How many questions each level takes from each kind of deck.
const MIX = { kana: { kana: 6 }, other: { vocab: 3, kanji: 2, grammar: 1 } };

export function levelQuestions(decks, level, rng = Math.random) {
  const pool = decks.filter(d => d.level === level);
  const mix = level === "kana" ? MIX.kana : MIX.other;
  const qs = [];
  for (const [kind, n] of Object.entries(mix)) {
    const items = pool.filter(d => d.kind === kind).flatMap(d => d.items.map(item => ({ item, deck: d })));
    for (const { item, deck } of shuffle(items, rng).slice(0, n))
      qs.push({ level, kind, prompt: item.q, hint: item.t, answer: item.a, opts: options(deck.items, item, "a", rng) });
  }
  return shuffle(qs, rng);
}

// `rights[i]` = correct answers in level i (in LEVELS order) for the levels asked so far.
// Returns the level to start at, or null while the test should keep going.
export function startLevel(levels, rights) {
  const failed = rights.findIndex(r => r < PASS);
  if (failed >= 0) return levels[failed].id;
  return rights.length === levels.length ? levels.at(-1).id : null;
}

// Curriculum entries the review may use: everything already seen plus new cards from the start level on.
export function fromLevel(entries, cards, level) {
  const start = entries.findIndex(e => e.deck.level === level);
  return start <= 0 ? entries : entries.filter((e, i) => i >= start || cards[e.key]);
}
