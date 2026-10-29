// Reading a progress backup (export file or automatic desktop copy). Everything is checked before
// anything is replaced: a bad file must never wipe the student's progress.
import { sanitizeCards } from "./scheduler.js";

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const count = v => Number.isInteger(v) && v >= 0;
const pair = v => Array.isArray(v) && v.length === 2 && v.every(count);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const validStats = s => isObj(s) && Object.values(s).every(pair);
const validExam = x => isObj(x) && count(x.right) && count(x.total) && typeof x.d === "string" &&
  isObj(x.per) && ["vocab", "gram", "read"].every(k => pair(x.per[k]));

// Only the preference fields the app knows, each with its own type.
function readPrefs(p, levels) {
  if (!isObj(p)) return undefined;
  const out = {};
  for (const k of ["voice", "ear", "reverse", "furigana"]) if (typeof p[k] === "boolean") out[k] = p[k];
  if (count(p.deck)) out.deck = p.deck;
  if (levels.includes(p.level)) out.level = p.level;
  if (Array.isArray(p.listenVoices) && p.listenVoices.every(v => typeof v === "string")) out.listenVoices = p.listenVoices;
  return out;
}

// Returns the parts to restore, or throws if the file isn't a Kana Pad backup.
// Optional parts that are damaged are left out (the current ones stay) and counted in `skipped`.
export function readBackup(data, levels = []) {
  if (!isObj(data) || data.app !== "kana-pad" || !validStats(data.stats) || !isObj(data.cards)) throw new Error("bad file");
  const cards = sanitizeCards(data.cards);
  const out = { stats: data.stats, cards, skipped: Object.keys(data.cards).length - Object.keys(cards).length };
  if (isObj(data.history) && Object.entries(data.history).every(([d, h]) => DATE.test(d) && isObj(h) &&
      [h.reviews, h.correct, h.answers, h.fresh].every(v => v === undefined || count(v)))) out.history = data.history;
  if (Array.isArray(data.exams)) out.exams = data.exams.filter(validExam).slice(-20);
  if (isObj(data.stories) && Object.values(data.stories).every(s => isObj(s) && count(s.right) && count(s.total))) out.stories = data.stories;
  if (isObj(data.kinds) && Object.values(data.kinds).every(pair)) out.kinds = data.kinds;
  out.prefs = readPrefs(data.prefs, levels);
  return out;
}
