// Numbers for the user dashboard ("Mi panel"). Pure functions over decks, cards, stats and history.
import { MATURE_DAYS } from "./progress.js";

const DAY_MS = 864e5;
const shift = (d, n) => new Date(Date.parse(d + "T12:00:00") + n * DAY_MS).toLocaleDateString("sv");
const isMature = c => c && c.state === 2 && c.scheduled_days >= MATURE_DAYS;

// Activity calendar: `weeks` columns of 7 days (Monday first), the last column holding `today`.
// Each cell is { d, n } with n = answers that day; days after today come back with n = null.
export function heatmap(history, today, weeks = 16) {
  const dow = (new Date(today + "T12:00:00").getDay() + 6) % 7; // 0 = Monday
  const start = shift(today, -(dow + 7 * (weeks - 1)));
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = shift(start, i);
    return { d, n: d > today ? null : history[d]?.answers ?? 0 };
  });
}

// Seen and mature cards per level, over every deck of that level.
export function levelProgress(decks, cards, levels) {
  return levels.map(lv => {
    let total = 0, seen = 0, mature = 0;
    for (const d of decks.filter(x => x.level === lv.id)) for (const it of d.items) {
      const c = cards[d.id + ":" + it.q];
      total++; if (c) seen++; if (isMature(c)) mature++;
    }
    return { id: lv.id, name: lv.name, total, seen, mature };
  });
}

export const KIND_NAMES = { kana: "Kana", vocab: "Vocabulario", kanji: "Kanji", grammar: "Gramática", listening: "Listening", reading: "Cuentos", draw: "Dibujo" };

// Hits over answers per kind of exercise. Deck kinds come from per-card stats [hits, misses];
// listening and stories keep [hits, misses] in `kinds`, drawing keeps [sum of scores, drawings].
export function kindAccuracy(decks, stats, kinds = {}) {
  const out = [];
  for (const kind of ["kana", "vocab", "kanji", "grammar"]) {
    let h = 0, m = 0;
    for (const d of decks.filter(x => x.kind === kind)) for (const it of d.items) {
      const s = stats[d.id + ":" + it.q]; if (s) { h += s[0]; m += s[1]; }
    }
    out.push({ kind, name: KIND_NAMES[kind], rate: h + m ? h / (h + m) : null, total: h + m });
  }
  for (const kind of ["listening", "reading"]) {
    const [h, m] = kinds[kind] ?? [0, 0];
    out.push({ kind, name: KIND_NAMES[kind], rate: h + m ? h / (h + m) : null, total: h + m });
  }
  const [sum, n] = kinds.draw ?? [0, 0];
  out.push({ kind: "draw", name: KIND_NAMES.draw, rate: n ? sum / (100 * n) : null, total: n });
  return out;
}

// The cards missed most often (at least `min` answers and more than one miss), worst first.
export function weakest(decks, stats, n = 8, min = 3) {
  const all = [];
  for (const d of decks) for (const it of d.items) {
    const s = stats[d.id + ":" + it.q];
    if (!s || s[0] + s[1] < min || s[1] < 2) continue;
    all.push({ q: it.q, a: d.kind === "grammar" ? it.r : it.a, deck: d.name, hits: s[0], misses: s[1], rate: s[1] / (s[0] + s[1]) });
  }
  return all.sort((x, y) => y.rate - x.rate || y.misses - x.misses).slice(0, n);
}

// When the student finishes the target level at the current pace. `entries` is the curriculum in
// order ({ key, deck }); the pace is new cards per day over the last two weeks (`fresh` in history),
// or `fallback` before there is any.
export function eta(entries, cards, history, today, target, fallback = 15) {
  const last = entries.findLastIndex(e => e.deck.level === target);
  if (last < 0) return null;
  const remaining = entries.slice(0, last + 1).filter(e => !cards[e.key]).length;
  let fresh = 0, days = 0;
  for (let i = 0; i < 14; i++) { const h = history[shift(today, -i)]; if (h?.answers) { days++; fresh += h.fresh ?? 0; } }
  const pace = fresh ? fresh / 14 : fallback;
  const need = Math.ceil(remaining / pace);
  return { remaining, pace, days: need, date: shift(today, need) };
}
