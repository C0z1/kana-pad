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
