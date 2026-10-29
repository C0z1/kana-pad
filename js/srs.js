// Card selection: weighted random where misses pull a card back and hits push it away.
export const weight = ([hits, misses] = [0, 0]) => (1 + 3 * misses) / (1 + hits);

export function pick(items, statsFor, rng = Math.random, avoid = null) {
  const pool = items.length > 1 ? items.filter(i => i !== avoid) : items;
  const ws = pool.map(i => weight(statsFor(i)));
  let r = rng() * ws.reduce((s, w) => s + w, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= ws[i]) <= 0) return pool[i];
  return pool[pool.length - 1];
}

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The right answer plus three distinct wrong ones, read from `field` ("a" forward, "q" reverse).
export function options(items, item, field, rng = Math.random) {
  // Grammar items bring their own distractors: other items' answers would often be correct too.
  if (item.o) return shuffle([item.a, ...item.o], rng);
  // A distractor must differ on both sides, and its meaning must not share a sense with the
  // answer's ("buscar" vs "investigar, buscar"): otherwise two answer bars would be correct.
  const other = field === "a" ? "q" : "a";
  const mine = senses(item.a);
  const wrong = [...new Set(items.filter(i => i[field] !== item[field] && i[other] !== item[other] && !senses(i.a).some(x => mine.includes(x))).map(i => i[field]))];
  return shuffle([item[field], ...shuffle(wrong, rng).slice(0, 3)], rng);
}

// "sonar (un timbre), tocar" → ["sonar", "tocar"]: the senses of a meaning, without notes in parentheses.
export const senses = a => String(a).toLowerCase().replace(/\([^)]*\)/g, "").split(/[,;]/).map(x => x.trim()).filter(Boolean);

// "ひと(つ)・いち" → "ひとつ、いち": parentheses mark okurigana in readings; the voice must not read them.
export const speakable = text => text.replace(/[()]/g, "").replace(/・/g, "、");

// Free practice of one deck: a card is never asked before it was taught. New cards come in
// curriculum order, one at a time, and only while few cards are still being learned, so the
// student isn't flooded with unknowns. `status(item)` is "new" | "learning" | "known".
// Returns { item, teach }: teach = show it with its answer marked instead of asking it.
export const LEARNING_MAX = 3;
export const LEARNED_HITS = 2; // hits (with more hits than misses) for a card to stop counting as "learning"
export function pickPractice(items, statsFor, status, rng = Math.random, avoid = null, lastTaught = false) {
  const fresh = items.filter(i => status(i) === "new");
  const seen = items.filter(i => status(i) !== "new");
  const learning = seen.filter(i => status(i) === "learning").length;
  // The first two are taught back to back so the first question isn't the card just shown.
  if (fresh.length && (seen.length < 2 || (!lastTaught && learning < LEARNING_MAX))) return { item: fresh[0], teach: true };
  return { item: pick(seen, statsFor, rng, avoid), teach: false };
}

// Learning status from free-practice stats [hits, misses] and the FSRS card (if any).
export function practiceStatus(s, card) {
  if (!s) return card ? (card.state === 2 ? "known" : "learning") : "new";
  const [hits, misses] = s;
  return hits >= LEARNED_HITS && hits > misses ? "known" : "learning";
}
