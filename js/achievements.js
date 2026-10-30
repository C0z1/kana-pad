// Logros: computed from what the app already stores (history, cards, exams, stories, records, Reto del día),
// so they need no storage of their own beyond the ids already announced. Pure functions.
const DAY_MS = 864e5;

// Longest run of consecutive dates ("YYYY-MM-DD") in a list. With `freeze` (Racha protegida), a single missed
// day jumps the gap once per week (Monday to Sunday) without counting, as in streakRun().
export function bestRun(dates, freeze = false) {
  const days = [...new Set(dates)].sort().map(d => Math.round(Date.parse(d + "T12:00:00Z") / DAY_MS));
  const week = n => Math.floor((n + 3) / 7); // day 0 (1970-01-01) is a Thursday; weeks start on Monday
  let best = 0, run = 0, used = new Set();
  days.forEach((d, i) => {
    const gap = i ? d - days[i - 1] : 0;
    if (gap === 1) run++;
    else if (freeze && gap === 2 && !used.has(week(d - 1))) { used.add(week(d - 1)); run++; }
    else { run = 1; used = new Set(); }
    best = Math.max(best, run);
  });
  return best;
}

// data: { history, cards, decks: deckStats(), exams, stories, records, daily, goal }
// Returns every achievement with `progress: [n, goal]` and `done`, in display order.
export function achievements({ history = {}, cards = {}, decks = [], exams = [], stories = {}, records = {}, daily = {}, goal = 20 }) {
  const studied = Object.entries(history).filter(([, h]) => (h.answers ?? 0) > 0);
  const streak = bestRun(studied.map(([d]) => d), true); // the same protected streak the panel shows
  // shortcut: the history doesn't keep the goal of each day, so past days are measured against today's goal;
  // store the goal per day if it ever matters.
  const goalDays = studied.filter(([, h]) => h.answers >= goal).length;
  const answers = studied.reduce((s, [, h]) => s + h.answers, 0);
  const deck = id => decks.find(d => d.id === id) ?? { total: 1, seen: 0, mature: 0 };
  const kanjiSeen = decks.filter(d => d.id.startsWith("kanji")).reduce((s, d) => s + d.seen, 0);
  const perfect = Object.values(stories).filter(s => s.total > 0 && s.right === s.total).length;
  const n5Pass = exams.some(x => (x.lv ?? "n5") === "n5" && x.pass) ? 1 : 0;
  const list = [
    ["streak3", "constancia", "Tres seguidos", "Estudia 3 días seguidos", "flame", streak, 3],
    ["streak7", "constancia", "Una semana", "Estudia 7 días seguidos", "flame", streak, 7],
    ["streak30", "constancia", "Un mes", "Estudia 30 días seguidos", "flame", streak, 30],
    ["goal7", "constancia", "Meta cumplida", "Cumple tu meta diaria 7 días", "practice", goalDays, 7],
    ["answers100", "volumen", "Calentando", "Responde 100 preguntas", "bolt", answers, 100],
    ["answers500", "volumen", "En forma", "Responde 500 preguntas", "bolt", answers, 500],
    ["answers2000", "volumen", "Incansable", "Responde 2,000 preguntas", "bolt", answers, 2000],
    ["cards100", "volumen", "Mazo propio", "Ten 100 cartas en repaso", "layers", Object.keys(cards).length, 100],
    ["hira", "dominio", "Hiragana dominado", "Todas las hiragana maduras", "stairs", deck("hira").mature, deck("hira").total],
    ["kata", "dominio", "Katakana dominado", "Todas las katakana maduras", "stairs", deck("kata").mature, deck("kata").total],
    ["kanji100", "dominio", "Cien kanji", "Ve 100 kanji", "pen", kanjiSeen, 100],
    ["examN5", "retos", "Aprobado N5", "Aprueba el simulacro N5", "exam", n5Pass, 1],
    ["time20", "retos", "Contra el reloj", "20 aciertos en Contrarreloj", "timer", records.time ?? 0, 20],
    ["survival15", "retos", "Superviviente", "15 seguidas en Supervivencia", "heart", records.survival ?? 0, 15],
    ["stories5", "retos", "Lector", "5 cuentos con todas bien", "book", perfect, 5],
    ["daily7", "retos", "Reto diario", "Haz el reto del día 7 días seguidos", "bolt", bestRun(Object.keys(daily)), 7],
  ];
  return list.map(([id, group, name, desc, icon, n, of]) => ({ id, group, name, desc, icon, progress: [Math.min(n, of), of], done: n >= of }));
}

// Achievements done but not yet announced, in order.
export const unseen = (list, seen) => list.filter(a => a.done && !seen.includes(a.id));
