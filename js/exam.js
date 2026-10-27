// N5 mock exam: 10 vocabulary, 10 grammar and 2 readings × 5 questions, scored per section.
import { options, shuffle } from "./srs.js";

export const SECTIONS = [
  { id: "vocab", name: "Vocabulario" },
  { id: "gram", name: "Gramática" },
  { id: "read", name: "Lectura" },
];
export const EXAM_SECONDS = 20 * 60;
// shortcut: own pass rule (60% total and 40% per section), loosely modeled on the JLPT's
// total + per-section minimums; revisit if the app ever reports real JLPT-scaled scores.
export const PASS_TOTAL = 0.6, PASS_SECTION = 0.4;

export function buildExam(vocab, grammar, readings, rng = Math.random) {
  const pick = (list, n) => shuffle(list, rng).slice(0, n);
  const vocabQs = pick(vocab, 10).map(it => ({ section: "vocab", prompt: it.q, item: it, answer: it.a, opts: options(vocab, it, "a", rng) }));
  const gramQs = pick(grammar, 10).map(it => ({ section: "gram", prompt: it.q, hint: it.t, item: it, answer: it.a, opts: options(grammar, it, "a", rng) }));
  const readQs = readings.flatMap(r => r.questions.map(q => ({ section: "read", passage: r.text, prompt: q.q, answer: q.a, opts: shuffle([q.a, ...q.o], rng) })));
  return [...vocabQs, ...gramQs, ...readQs];
}

// answers[i] is the chosen option text (or undefined if time ran out).
export function scoreExam(questions, answers) {
  const per = Object.fromEntries(SECTIONS.map(s => [s.id, { right: 0, total: 0, missed: [] }]));
  questions.forEach((q, i) => {
    const s = per[q.section];
    s.total++;
    if (answers[i] === q.answer) s.right++;
    else s.missed.push(q);
  });
  const right = Object.values(per).reduce((n, s) => n + s.right, 0);
  const total = questions.length;
  const pass = right / total >= PASS_TOTAL && Object.values(per).every(s => s.total === 0 || s.right / s.total >= PASS_SECTION);
  return { per, right, total, pass };
}

export const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
