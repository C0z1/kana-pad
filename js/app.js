import { DECKS } from "./data.js";
import { pick, options, speakable } from "./srs.js";
import { createPad } from "./gamepad.js";
import { grade, queue, nextDue, interleave, sanitizeCards, newCardsToday, studyDay, dayEnd, pickNext, NEW_PER_DAY } from "./scheduler.js";
import { store } from "./storage.js";
import { strokePaths, strokeSvg, STROKE_SECONDS } from "./strokes.js";
import { retention, streakDays, deckStats, forecast } from "./progress.js";
import { buildExam, scoreExam, clock, SECTIONS, EXAM_SECONDS } from "./exam.js";
import { READING_N5 } from "./content/reading-n5.js";

const KEYS = ["y", "x", "b", "a"]; // top-to-bottom order of the answer bars
const ROUND = 10;
const $ = id => document.getElementById(id);

// "Repaso de hoy" mixes every deck through FSRS; the other entries are free practice per deck.
const REVIEW = { id: "review", name: "Repaso de hoy", kind: "review" };
const MODES = [REVIEW, ...DECKS];
const entriesOf = id => { const deck = DECKS.find(d => d.id === id); return deck.items.map(item => ({ key: deck.id + ":" + item.q, item, deck })); };
// New cards: all kana first, then 3 words : 1 grammar point : 1 kanji.
const ENTRIES = [...entriesOf("hira"), ...entriesOf("kata"),
  ...interleave([entriesOf("vocab"), entriesOf("gram5"), entriesOf("kanji")], [3, 1, 1])];

const todayKey = () => studyDay(); // local YYYY-MM-DD; the study day ends at 4:00
let stats = store.getSync("kp-stats", {});            // "deck:q" -> [hits, misses], free-practice weights
let day = store.getSync("kp-day", { d: todayKey(), n: 0, fresh: 0 });
let history = store.getSync("kp-hist", {}); // "YYYY-MM-DD" -> { reviews, correct } of mature-review answers, { answers } of all
const prefs = { deck: 0, voice: true, ear: false, reverse: false, ...store.getSync("kp-prefs", {}) };
if (!MODES[prefs.deck]) prefs.deck = 0;
let cards = {}; // FSRS state per key, loaded from IndexedDB before the first round
let ready = false; // starting before cards load would overwrite the saved schedule

let screen = "start"; // start | play | pause | summary | progress | exam
let cur = null, opts = [], locked = false, streak = 0, lastKey = null, timer = 0, shownAt = 0;
let teaching = false; // a new card is shown with its answer before it is ever asked
let recent = []; // cards shown lately: { key, t, taught }, for the breather between repeats
let resting = false; // the queue has cards, but all of them were just shown
let jaVoice = false;  // ear mode is impossible without a Japanese voice
let round = { results: [], missed: [] };

const mode = () => MODES[prefs.deck];
const isReview = () => mode() === REVIEW;
const keyOf = (deck, item) => deck.id + ":" + item.q;
const earOn = deck => prefs.ear && prefs.voice && jaVoice && deck.kind !== "grammar";
// Ear mode always asks forward; grammar always asks for the missing piece.
const answerField = deck => (prefs.reverse && !earOn(deck) && deck.kind !== "grammar" ? "q" : "a");
const savePrefs = () => store.setSync("kp-prefs", prefs);
const dueNow = () => {
  const now = Date.now(), end = dayEnd().getTime();
  return Object.values(cards).filter(c => Date.parse(c.due) <= (c.state === 2 ? end : now)).length;
};
// Starts a new day (also when the app stays open past midnight) and fixes today's new-card limit.
function rollDay() {
  if (day.d !== todayKey()) day = { d: todayKey(), n: 0, fresh: 0 };
  day.fresh ??= 0;
  if (ready) day.limit = newCardsToday(dueNow(), history, day.d); // live: the brake lifts as the backlog clears
}
rollDay();
const reviewQueue = () => queue(ENTRIES, cards, new Date(), (day.limit ?? NEW_PER_DAY) - day.fresh, day.d);
const pending = () => reviewQueue().length;

// ---------- rendering ----------
function renderTop() {
  rollDay();
  const m = mode();
  $("decktag").textContent = m.name.toUpperCase();
  if (isReview()) {
    $("acc").textContent = `${pending()} pendientes`;
  } else {
    let h = 0, mi = 0;
    for (const it of m.items) { const s = stats[keyOf(m, it)]; if (s) { h += s[0]; mi += s[1]; } }
    $("acc").textContent = h + mi ? `${Math.round((100 * h) / (h + mi))}% aciertos` : "– aciertos";
  }
  $("streak").textContent = "×" + streak;
  $("today").textContent = day.n;
  const grammar = (cur?.deck ?? m).kind === "grammar";
  $("ear").setAttribute("aria-pressed", prefs.ear);
  $("reverse").setAttribute("aria-pressed", prefs.reverse);
  $("ear").disabled = grammar || !jaVoice;
  $("ear").title = !jaVoice ? "Instala una voz japonesa: Configuración → Hora e idioma → Voz" : grammar ? "No aplica en gramática" : "";
  $("reverse").disabled = grammar;
  $("voice").checked = prefs.voice;
}

function renderPips() {
  $("pips").replaceChildren(...Array.from({ length: ROUND }, (_, i) => {
    const pip = document.createElement("i");
    if (round.results[i] !== undefined) pip.className = round.results[i] ? "hit" : "miss";
    return pip;
  }));
  $("roundtxt").textContent = `${round.results.length} / ${ROUND}`;
}

const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

function showPrompt(revealed) {
  const q = $("q"), { item, deck } = cur;
  q.lang = deck.kind === "grammar" || answerField(deck) !== "q" || revealed ? "ja" : "es";
  if (earOn(deck) && !revealed) {
    q.className = "glyph ear";
    q.innerHTML = SPEAKER + "<span>Escucha</span>";
  } else if (deck.kind === "grammar") {
    q.className = "glyph sentence";
    q.textContent = revealed ? item.r : item.q;
  } else if (answerField(deck) === "q" && !revealed) {
    q.className = "glyph latin";
    q.textContent = item.a;
  } else {
    q.className = "glyph" + (item.q.length === 2 ? " len2" : item.q.length > 2 ? " len3" : "");
    q.textContent = item.q;
  }
}

function hintFor(deck) {
  if (deck.kind === "grammar") return `Completa: ${cur.item.t}`;
  if (earOn(deck)) return "¿Qué escuchaste?";
  if (answerField(deck) === "q") return "¿Cómo se escribe?";
  return deck.kind === "kana" ? "¿Cómo se lee?" : "¿Qué significa?";
}

function nextCard() {
  if (isReview()) {
    const q = reviewQueue();
    const e = pickNext(q, recent, Date.now(), x => !cards[x.key]);
    resting = !e && q.length > 0;
    return e ? { item: e.item, deck: e.deck } : null;
  }
  const deck = mode();
  const prev = deck.items.find(i => keyOf(deck, i) === lastKey);
  return { item: pick(deck.items, it => stats[keyOf(deck, it)], Math.random, prev), deck };
}

function next() {
  clearTimeout(timer);
  rollDay();
  if (round.results.length >= ROUND) return showSummary();
  cur = nextCard();
  if (!cur) return showSummary();
  const { item, deck } = cur;
  lastKey = keyOf(deck, item);
  opts = options(deck.items, item, answerField(deck));
  teaching = isReview() && !cards[lastKey];
  recent = [...recent.slice(-4), { key: lastKey, t: Date.now(), taught: teaching }];
  showPrompt(teaching);
  $("hint").textContent = teaching ? "Carta nueva: pulsa la respuesta marcada" : hintFor(deck);
  $("reading").textContent = teaching && deck.kind !== "grammar" ? (item.r ?? "") : "";
  $("verdict").textContent = ""; $("verdict").className = "verdict";
  $("note").textContent = teaching && deck.kind === "grammar" ? item.n : "";
  $("stage").querySelector(".prompt").className = "prompt";
  $("tagnew").hidden = !teaching;
  $("opts").replaceChildren(...KEYS.map((k, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "bar"; b.dataset.k = k;
    const badge = document.createElement("span");
    badge.className = "badge"; badge.dataset.k = k; badge.textContent = k.toUpperCase();
    const label = document.createElement("span");
    label.className = "label" + (answerField(deck) === "q" || deck.kind === "grammar" ? " jp" : "");
    label.textContent = opts[i];
    label.lang = label.classList.contains("jp") ? "ja" : "es";
    b.append(badge, label);
    b.addEventListener("click", () => answer(k));
    if (teaching) b.classList.add(opts[i] === item[answerField(deck)] ? "right" : "dim");
    return b;
  }));
  renderPips(); renderTop();
  locked = false;
  shownAt = performance.now();
  if (teaching) {
    speak(item.r || item.q);
    if (deck.kind === "kanji") showStrokes(item.q);
  } else if (answerField(deck) === "a" && deck.kind !== "grammar") speak(item.r || item.q);
}

async function showStrokes(ch) {
  const paths = await strokePaths(ch);
  if (!paths.length || cur?.item.q !== ch) return;
  $("q").className = "glyph";
  $("q").replaceChildren(strokeSvg(paths));
  return paths.length;
}

function countAnswer() {
  const h = (history[day.d] ??= { reviews: 0, correct: 0 });
  h.answers = (h.answers ?? 0) + 1;
  store.setSync("kp-hist", history);
}

function answer(k) {
  if (screen !== "play" || locked || !cur) return;
  const { item, deck } = cur;
  const key = keyOf(deck, item);
  const field = answerField(deck);
  const chosen = opts[KEYS.indexOf(k)];
  if (teaching) {
    // Only the highlighted answer moves on; it is graded as a first, unhurried success.
    if (chosen !== item[field]) return;
    locked = true;
    day.fresh++; day.n++; countAnswer();
    cards[key] = grade(undefined, true, 0);
    store.set("kp-cards", cards); store.setSync("kp-day", day);
    renderTop();
    timer = setTimeout(next, 300);
    return;
  }
  locked = true;
  const ok = chosen === item[field];
  const ms = performance.now() - shownAt;

  const s = stats[key] || [0, 0];
  s[ok ? 0 : 1]++;
  stats[key] = s;
  if (isReview()) {
    if (!cards[key]) day.fresh++;
    else if (cards[key].state === 2) {
      const h = (history[day.d] ??= { reviews: 0, correct: 0 });
      h.reviews++; if (ok) h.correct++;
      store.setSync("kp-hist", history);
    }
    cards[key] = grade(cards[key], ok, ms);
    store.set("kp-cards", cards);
  }
  streak = ok ? streak + 1 : 0;
  day.n++; countAnswer();
  round.results.push(ok);
  if (!ok) round.missed.push(item);
  store.setSync("kp-stats", stats); store.setSync("kp-day", day);

  for (const b of $("opts").children) {
    const v = opts[KEYS.indexOf(b.dataset.k)];
    if (v === item[field]) b.classList.add("right");
    else if (b.dataset.k === k) b.classList.add("wrong");
    else b.classList.add("dim");
  }
  showPrompt(true);
  $("stage").querySelector(".prompt").className = "prompt " + (ok ? "ok" : "bad");
  if (deck.kind !== "grammar" && item.r) $("reading").textContent = item.r;
  if (ok) $("verdict").textContent = "¡CORRECTO!";
  else {
    const right = document.createElement("span");
    right.className = /[぀-ヿ一-鿿]/.test(item[field]) ? "jp" : "";
    right.textContent = item[field];
    if (right.className) right.lang = "ja";
    $("verdict").replaceChildren("ERA: ", right);
  }
  $("verdict").className = "verdict " + (ok ? "ok" : "bad");
  if (deck.kind === "grammar") {
    $("note").textContent = item.n;
  } else if (!ok) {
    const picked = deck.items.find(i => i[field] === chosen);
    if (picked) {
      const jp = document.createElement("span");
      jp.className = "jp"; jp.lang = "ja"; jp.textContent = picked.q;
      $("note").replaceChildren("Tu respuesta: ", jp, ` = ${picked.a}`);
    }
  }
  if (!ok) pad.rumble();
  else {
    const combo = $("streak").parentElement;
    combo.classList.remove("bump"); void combo.offsetWidth; combo.classList.add("bump");
  }
  if (field === "q" || deck.kind === "grammar") speak(item.r || item.q);
  renderTop(); renderPips();

  let wait = ok ? 800 : 2200;
  if (deck.kind === "grammar") wait = ok ? 2200 : 3500;
  if (deck.kind === "kanji") {
    showStrokes(item.q).then(n => {
      if (!n || screen !== "play") return;
      clearTimeout(timer);
      timer = setTimeout(next, Math.max(wait, n * STROKE_SECONDS * 1000 + 900));
    });
  }
  timer = setTimeout(next, wait);
}

function showSummary() {
  screen = "summary";
  $("stage").hidden = true; $("summary").hidden = false;
  const hits = round.results.filter(Boolean).length;
  const done = round.results.length;
  if (isReview() && resting) {
    $("sumtitle").textContent = "Un respiro";
    $("score").textContent = done ? `${hits} / ${done}` : "…";
    $("sumnote").textContent = "Las cartas que quedan acaban de salir. Vuelve en un minuto para repasarlas otra vez.";
  } else if (isReview() && done < ROUND) {
    const nd = nextDue(cards);
    $("sumtitle").textContent = "¡Todo al día!";
    $("score").textContent = done ? `${hits} / ${done}` : "0 pendientes";
    $("sumnote").textContent = nd
      ? `Próximo repaso: ${nd.toLocaleString("es", { weekday: "long", hour: "2-digit", minute: "2-digit" })}. Mientras, practica un mazo con LB/RB.`
      : "Practica un mazo con LB/RB.";
  } else {
    $("sumtitle").textContent = "Ronda terminada";
    $("score").textContent = `${hits} / ${done}`;
    $("sumnote").textContent = isReview() ? `Quedan ${pending()} cartas para hoy.` : "";
  }
  const braked = isReview() && day.limit !== undefined && day.limit < NEW_PER_DAY;
  $("brake").hidden = !braked;
  if (braked) $("braketxt").textContent = day.limit === 0
    ? "Hoy no entran cartas nuevas: primero hay que ponerse al día con los repasos pendientes."
    : `Hoy solo entran ${day.limit} cartas nuevas: hay muchos repasos pendientes o los aciertos bajaron. Así no se acumula.`;
  const counts = new Map();
  for (const it of round.missed) counts.set(it, (counts.get(it) ?? 0) + 1);
  $("missed").replaceChildren(...[...counts].map(([it, n]) => {
    const li = document.createElement("li");
    const inner = document.createElement("span");
    const jp = document.createElement("span");
    jp.className = "jp"; jp.lang = "ja"; jp.textContent = it.r && it.t ? it.r : it.q;
    inner.append(jp, it.t && it.r ? "" : it.a, n > 1 ? ` ×${n}` : "");
    li.append(inner);
    return li;
  }));
  renderTop();
  $("again").focus();
}

function newRound() {
  round = { results: [], missed: [] };
  screen = "play";
  $("summary").hidden = true; $("stage").hidden = false;
  next();
}

// ---------- actions ----------
function setDeck(i) {
  prefs.deck = (i + MODES.length) % MODES.length;
  savePrefs(); streak = 0; lastKey = null;
  renderTop();
  if (screen === "play" || screen === "summary") newRound();
}
function toggle(name) {
  if (name === "ear" && !jaVoice) {
    $("note").textContent = "El modo oído necesita una voz japonesa. En Windows: Configuración → Hora e idioma → Voz → Agregar voces → Japonés.";
    return;
  }
  if ((name === "ear" || name === "reverse") && (cur?.deck ?? mode()).kind === "grammar") return;
  prefs[name] = !prefs[name];
  savePrefs(); renderTop();
  if (name === "voice" && !prefs.voice) speechSynthesis?.cancel();
  if ((name === "ear" || name === "reverse") && screen === "play") { lastKey = null; next(); }
}
function setPaused(p) {
  if (p && screen === "play") {
    screen = "pause"; clearTimeout(timer);
    $("starttxt").textContent = "Continuar";
    $("overlay").hidden = false; document.querySelector(".app").inert = true; $("start").focus();
  } else if (!p && ready && (screen === "pause" || screen === "start")) {
    const fresh = screen === "start";
    screen = "play"; $("overlay").hidden = true; document.querySelector(".app").inert = false;
    keepAwake();
    if (fresh) newRound(); else if (locked) next();
  }
}

function speak(text) {
  if (!prefs.voice || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = "ja-JP"; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find(v => v.lang.startsWith("ja"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// Keeps the screen on during cardio; the browser may refuse, which is fine.
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  // The browser drops the lock whenever the tab is hidden.
  if (document.visibilityState === "visible" && screen === "play" && (!wakeLock || wakeLock.released)) keepAwake();
});

// ---------- progress panel ----------
const TABS = ["hoy", "mazos", "pron"];
let tab = "hoy";
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function renderProgress() {
  rollDay();
  const ret = retention(history, day.d);
  const kpi = (value, label) => { const d = el("div", "kpi"); d.append(el("b", "", value), el("span", "", label)); return d; };
  const streakN = streakDays(history, day.d);
  $("progress").querySelector(".kpis").replaceChildren(
    kpi(String(day.n), "respuestas hoy"),
    kpi(ret === null ? "—" : `${Math.round(ret * 100)}%`, "retención de cartas maduras (3 días)"),
    kpi(`${day.fresh}/${day.limit ?? NEW_PER_DAY}`, "cartas nuevas hoy"),
    kpi(String(streakN), streakN === 1 ? "día seguido" : "días seguidos"),
  );
  const last = exams.at(-1);
  if (last) $("progress").querySelector(".kpis").append(el("p", "notice pexam",
    `Último simulacro (${last.d}): ${last.right}/${last.total} · ${last.pass ? "Aprobado" : "No aprobado"} — vocabulario ${last.per.vocab.join("/")}, gramática ${last.per.gram.join("/")}, lectura ${last.per.read.join("/")}.`));
  const limit = day.limit ?? NEW_PER_DAY;
  if (limit < NEW_PER_DAY) {
    const why = el("p", "notice pbrake");
    why.append(el("span", "tag-brake", "FRENO"), limit === 0
      ? `Hoy no entran cartas nuevas: tienes más de 200 repasos pendientes. Haz solo "Repaso de hoy" hasta bajar de 100 y las nuevas vuelven solas.`
      : dueNow() > 100
        ? `Hoy entran ${limit} cartas nuevas en vez de ${NEW_PER_DAY}: tienes más de 100 repasos pendientes. Repasa primero y el límite sube solo.`
        : `Hoy entran ${limit} cartas nuevas en vez de ${NEW_PER_DAY}: aciertas menos del 70% de las cartas maduras. Unos días repasando sin prisa lo corrigen.`);
    $("progress").querySelector(".kpis").append(why);
  }
  $("progress").querySelector(".decklist").replaceChildren(...deckStats(DECKS, cards).map(d => {
    const row = el("div", "drow");
    const meter = el("div", "meter"); const fill = el("i"); fill.style.width = `${(100 * d.seen) / d.total}%`; meter.append(fill);
    row.append(el("span", "", d.name), meter, el("small", "", `${d.seen}/${d.total} · ${d.mature} maduras`));
    return row;
  }));
  const ends = Array.from({ length: 7 }, (_, i) => { const e = dayEnd(); e.setDate(e.getDate() + i); return e; });
  const counts = forecast(cards, ends), max = Math.max(1, ...counts);
  $("progress").querySelector(".forecast").replaceChildren(...counts.map((n, i) => {
    const row = el("div", "frow");
    const label = i === 0 ? "hoy" : new Date(ends[i].getTime() - 5 * 3600e3).toLocaleDateString("es", { weekday: "short", day: "numeric" });
    const meter = el("div", "meter"); const fill = el("i"); fill.style.width = `${(100 * n) / max}%`; meter.append(fill);
    row.append(el("span", "", label), meter, el("small", "", `${n} ${n === 1 ? "carta" : "cartas"}`));
    return row;
  }));
}

function setTab(t) {
  tab = TABS[(TABS.indexOf(t) + TABS.length) % TABS.length];
  for (const b of $("progress").querySelectorAll(".tab")) {
    b.setAttribute("aria-selected", b.dataset.tab === tab);
    if (b.dataset.tab === tab && $("progress").contains(document.activeElement)) b.focus();
  }
  for (const p of $("progress").querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
}
function openProgress() {
  if (screen !== "pause" && screen !== "start") return;
  progressFrom = screen; screen = "progress";
  renderProgress(); setTab("hoy");
  $("overlay").hidden = true; $("progress").hidden = false;
  $("progress").querySelector(".tab").focus();
}
let progressFrom = "start";
function closeProgress() {
  screen = progressFrom;
  $("progress").hidden = true; $("overlay").hidden = false;
  $("openprogress").focus();
}
$("openprogress").addEventListener("click", openProgress);
$("closeprogress").addEventListener("click", closeProgress);
for (const b of $("progress").querySelectorAll(".tab")) b.addEventListener("click", () => setTab(b.dataset.tab));

// ---------- mock exam ----------
let exam = null; // { qs, answers, i, left, paused, timer, from }
let exams = []; // past results, newest last
const deckOf = id => DECKS.find(d => d.id === id);

function startExam() {
  if (screen !== "pause" && screen !== "start") return;
  exam = { qs: buildExam(deckOf("vocab").items, deckOf("gram5").items, READING_N5), answers: [], i: 0, left: EXAM_SECONDS, paused: false, from: screen };
  screen = "exam";
  $("overlay").hidden = true; $("exam").hidden = false;
  $("ebody").hidden = false; $("eresult").hidden = true; $("epause").hidden = true;
  exam.timer = setInterval(() => {
    if (exam.paused) return;
    exam.left--;
    renderClock();
    if (exam.left <= 0) finishExam();
  }, 1000);
  renderClock(); renderExamQ();
}

function renderClock() {
  $("etimer").textContent = clock(Math.max(0, exam.left));
  $("etimer").classList.toggle("low", exam.left < 60);
}

function renderExamQ() {
  const q = exam.qs[exam.i];
  const n = SECTIONS.findIndex(s => s.id === q.section);
  $("esec").textContent = `${n + 1} · ${SECTIONS[n].name} · pregunta ${exam.i + 1} de ${exam.qs.length}`;
  const reading = q.section === "read";
  $("eprompt").hidden = reading; $("epassage").hidden = !reading;
  $("equestion").hidden = !reading;
  if (reading) {
    $("epassage").textContent = q.passage;
    $("equestion").textContent = q.prompt;
  } else {
    const eq = $("eq");
    eq.lang = "ja";
    eq.className = q.section === "gram" ? "glyph sentence" : "glyph" + (q.prompt.length === 2 ? " len2" : q.prompt.length > 2 ? " len3" : "");
    eq.textContent = q.prompt;
    $("ehint").textContent = q.section === "gram" ? `Completa: ${q.hint}` : "¿Qué significa?";
  }
  $("eopts").replaceChildren(...KEYS.map((k, i) => {
    const b = el("button", "bar"); b.type = "button"; b.dataset.k = k;
    const badge = el("span", "badge", k.toUpperCase()); badge.dataset.k = k;
    const label = el("span", "label" + (q.section === "gram" ? " jp" : ""), q.opts[i]);
    label.lang = q.section === "gram" ? "ja" : "es";
    b.append(badge, label);
    b.addEventListener("click", () => examAnswer(k));
    return b;
  }));
  $("epips").replaceChildren(...exam.qs.map((_, i) => el("i", i < exam.i ? "done" : i === exam.i ? "now" : "")));
}

function examAnswer(k) {
  if (!exam || exam.paused || exam.locked || !$("eresult").hidden) return;
  const q = exam.qs[exam.i];
  exam.answers[exam.i] = q.opts[KEYS.indexOf(k)];
  exam.locked = true;
  $("eopts").querySelector(`[data-k="${k}"]`).classList.add("chosen");
  setTimeout(() => {
    exam.locked = false;
    exam.i++;
    if (exam.i >= exam.qs.length) finishExam(); else renderExamQ();
  }, 300);
}

function setExamPaused(p) {
  if (!exam || !$("eresult").hidden) return;
  exam.paused = p;
  $("epause").hidden = !p;
}

function finishExam() {
  clearInterval(exam.timer);
  const r = scoreExam(exam.qs, exam.answers);
  exams = [...exams, { d: day.d, right: r.right, total: r.total, pass: r.pass, per: Object.fromEntries(Object.entries(r.per).map(([k, v]) => [k, [v.right, v.total]])) }].slice(-20);
  store.set("kp-exams", exams);
  $("ebody").hidden = true; $("eresult").hidden = false; $("epause").hidden = true;
  $("esec").textContent = "Resultado";
  $("escores").replaceChildren(...SECTIONS.map(s => {
    const d = el("div", "escore");
    d.append(el("b", "", `${r.per[s.id].right}/${r.per[s.id].total}`), el("span", "", s.name));
    return d;
  }));
  $("epass").textContent = `${r.right}/${r.total} · ${r.pass ? "Aprobado" : "No aprobado"}`;
  $("epass").className = "epass " + (r.pass ? "ok" : "bad");
  $("emissed").replaceChildren(...SECTIONS.filter(s => r.per[s.id].missed.length).map(s => {
    const box = el("div");
    const ul = el("ul", "missed");
    ul.append(...r.per[s.id].missed.map(q => {
      const li = el("li"); const inner = el("span");
      if (q.section === "read") inner.append(`${q.prompt} → ${q.answer}`);
      else { const jp = el("span", "jp", q.item.r && q.item.t ? q.item.r : q.prompt); jp.lang = "ja"; inner.append(jp, q.section === "gram" ? "" : q.answer); }
      li.append(inner); return li;
    }));
    box.append(el("p", "emsection", s.name), ul);
    return box;
  }));
  $("eback").focus({ preventScroll: true }); $("exam").scrollTop = 0; // scores first, not the bottom button
}

function closeExam() {
  clearInterval(exam?.timer);
  screen = exam?.from ?? "start"; exam = null;
  $("exam").hidden = true; $("overlay").hidden = false;
  $("openexam").focus();
}
$("openexam").addEventListener("click", startExam);
$("eback").addEventListener("click", closeExam);

// ---------- input ----------
const ANSWER_BUTTONS = { 0: "a", 1: "b", 2: "x", 3: "y", 12: "y", 13: "a", 14: "x", 15: "b" };
const pad = createPad(i => {
  if (screen === "exam") {
    if (!$("eresult").hidden) { if (i === 0 || i === 1) closeExam(); return; }
    if (i === 9) return setExamPaused(!exam.paused);
    if (exam.paused) { if (i === 0) setExamPaused(false); return; }
    if (ANSWER_BUTTONS[i]) examAnswer(ANSWER_BUTTONS[i]);
    return; // LB/RB and the modes stay locked during the exam
  }
  if (screen === "progress") {
    if (i === 4) setTab(TABS[TABS.indexOf(tab) - 1] ?? TABS.at(-1));
    else if (i === 5) setTab(TABS[TABS.indexOf(tab) + 1] ?? TABS[0]);
    else if (i === 1 || i === 9) closeProgress();
    return;
  }
  if (i === 4) return setDeck(prefs.deck - 1);
  if (i === 5) return setDeck(prefs.deck + 1);
  if (i === 8) return toggle("voice");
  if (screen === "start" || screen === "pause") {
    if (i === 0 || i === 9) setPaused(false);
    else if (i === 3) openProgress();
    else if (i === 2) startExam();
    return;
  }
  if (screen === "summary") { if (i === 0) newRound(); return; }
  if (i === 9) return setPaused(true);
  if (i === 6) return toggle("ear");
  if (i === 7) return toggle("reverse");
  if (ANSWER_BUTTONS[i]) answer(ANSWER_BUTTONS[i]);
});

document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, select, textarea")) return;
  const arrows = { ArrowUp: "y", ArrowLeft: "x", ArrowRight: "b", ArrowDown: "a" };
  const key = e.key.toLowerCase();
  if (screen === "exam") {
    // preventDefault: otherwise the same Enter also "clicks" the button that just got focus.
    if (!$("eresult").hidden) { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeExam(); } return; }
    if (e.key === "Escape") return setExamPaused(!exam.paused);
    if (exam.paused) { if (e.key === "Enter") { e.preventDefault(); setExamPaused(false); } return; }
    if (arrows[e.key]) { e.preventDefault(); examAnswer(arrows[e.key]); }
    return;
  }
  if (screen === "progress") {
    if (key === "q") setTab(TABS[TABS.indexOf(tab) - 1] ?? TABS.at(-1));
    else if (key === "e") setTab(TABS[TABS.indexOf(tab) + 1] ?? TABS[0]);
    else if (e.key === "Escape" || key === "b") closeProgress();
    return;
  }
  if (key === "p" && (screen === "pause" || screen === "start")) return openProgress();
  if (key === "x" && (screen === "pause" || screen === "start")) return startExam();
  if (arrows[e.key] && screen === "play") { e.preventDefault(); answer(arrows[e.key]); }
  else if (key === "q") setDeck(prefs.deck - 1);
  else if (key === "e") setDeck(prefs.deck + 1);
  else if (key === "s") toggle("voice");
  else if (key === "o") toggle("ear");
  else if (key === "i") toggle("reverse");
  else if (e.key === "Escape" && (screen === "play" || screen === "pause")) setPaused(screen === "play");
  else if (e.key === "Enter" && screen === "summary") { e.preventDefault(); newRound(); }
});

$("start").addEventListener("click", () => setPaused(false));
$("again").addEventListener("click", newRound);
$("decktag").addEventListener("click", () => setDeck(prefs.deck + 1));
$("ear").addEventListener("click", () => toggle("ear"));
$("reverse").addEventListener("click", () => toggle("reverse"));
$("voice").addEventListener("change", () => toggle("voice"));
$("repad").addEventListener("click", () => { pad.reset(); $("msg").textContent = "Pulsa un botón en el mando que quieras usar."; });

// ---------- progress backup ----------
const validStats = s => s && typeof s === "object" &&
  Object.values(s).every(v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= 0));

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "kana-pad", v: 2, stats, cards, day, prefs }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kana-pad-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("msg").textContent = "Progreso exportado.";
});
$("import").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== "kana-pad" || !validStats(data.stats) || (data.cards !== undefined && (!data.cards || typeof data.cards !== "object"))) throw new Error("bad file");
    stats = data.stats; store.setSync("kp-stats", stats);
    let skipped = 0;
    if (data.cards) {
      cards = sanitizeCards(data.cards);
      skipped = Object.keys(data.cards).length - Object.keys(cards).length;
      await store.set("kp-cards", cards);
    }
    renderTop();
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    $("msg").textContent = `Progreso importado: ${n(Object.keys(stats).length, "carta practicada", "cartas practicadas")}, ${Object.keys(cards).length} en repaso.` +
      (skipped ? ` Se ${skipped === 1 ? "omitió" : "omitieron"} ${n(skipped, "carta dañada", "cartas dañadas")}; ${skipped === 1 ? "volverá como nueva" : "volverán como nuevas"}.` : "");
  } catch {
    $("msg").textContent = "Ese archivo no es una copia de Kana Pad. Exporta uno desde esta pantalla y vuelve a intentarlo.";
  }
});

setInterval(() => {
  const s = pad.status();
  $("dot").classList.toggle("on", s.on);
  $("padtxt").textContent = s.text;
}, 500);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
function checkVoices() {
  jaVoice = !!window.speechSynthesis?.getVoices().some(v => v.lang.startsWith("ja"));
  renderTop();
}
window.speechSynthesis?.addEventListener?.("voiceschanged", checkVoices);
checkVoices();
document.querySelector(".app").inert = true;
$("start").disabled = true;
store.get("kp-exams", []).then(x => { exams = Array.isArray(x) ? x : []; });
store.get("kp-cards", {}).then(c => {
  cards = sanitizeCards(c);
  ready = true; $("start").disabled = false;
  rollDay(); store.setSync("kp-day", day);
  renderTop();
});
renderTop();
$("start").focus();
