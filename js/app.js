import { DECKS, LEVELS } from "./data.js";
import { pick, options, speakable, pickPractice, practiceStatus } from "./srs.js";
import { createPad } from "./gamepad.js";
import { grade, queue, nextDue, interleave, sanitizeCards, newCardsToday, studyDay, dayEnd, pickNext, NEW_PER_DAY, BREATHER_CARDS, BREATHER_MS } from "./scheduler.js";
import { store } from "./storage.js";
import { strokePaths, strokeSvg, STROKE_SECONDS } from "./strokes.js";
import { retention, streakDays, streakRun, deckStats, forecast, backupDue, daysSince } from "./progress.js";
import { buildExam, scoreExam, clock, SECTIONS, EXAM_SECONDS } from "./exam.js";
import { READING_N5 } from "./content/reading-n5.js";
import { STORIES_N5 } from "./content/stories-n5.js";
import { parseWord, parseStory, lookupWord } from "./stories.js";
import { activeVoices, pickVoice, voiceVariation, buildListening } from "./listening.js";
import { BUILT_IN, clipUrl, clipPath } from "./voices.js";
import { readBackup } from "./backup.js";
import { allTexts } from "./clips.js";
import { heatmap, levelProgress, kindAccuracy, weakest, eta, mistakes, weekSummary } from "./dashboard.js";
import { ankiCall, readDeck } from "./anki.js";
import { mergeProgress, changed } from "./merge.js";
import * as cloud from "./cloud.js";
import { levelQuestions, startLevel, fromLevel, PER_LEVEL } from "./placement.js";
import { grade as gradeDrawing, verdict, pathPoints } from "./draw.js";
import { shuffle } from "./srs.js";
import { icon } from "./icons.js";
import { achievements, unseen } from "./achievements.js";
import { sfx } from "./sfx.js";
import { CHALLENGES, MIN_POOL, challengeQuestion, runOver, recordRun, dailyQuestions, DAILY_QUESTIONS } from "./challenges.js";

const KEYS = ["y", "x", "b", "a"]; // top-to-bottom order of the answer bars
const ROUND = 10;
const $ = id => document.getElementById(id);

// "Repaso de hoy" mixes every deck through FSRS; the other entries are free practice per deck.
const REVIEW = { id: "review", name: "Repaso de hoy", kind: "review" };
// Free practice over everything already seen; it never touches the FSRS schedule.
const PRACTICE = { id: "seen", name: "Práctica de lo visto", kind: "practice" };
// The cards missed most, from every deck (Mis errores); it never touches the FSRS schedule either.
const MISTAKES = { id: "errors", name: "Mis errores", kind: "practice" };
// Decks imported from Anki go last, so the saved deck index of the built-in ones never moves.
let ankiDecks = store.getSync("kp-anki", []);
const MODES = [REVIEW, PRACTICE, ...DECKS, MISTAKES, ...ankiDecks];
const entriesOf = id => { const deck = DECKS.find(d => d.id === id); return deck.items.map(item => ({ key: deck.id + ":" + item.q, item, deck })); };
// New cards: all kana first, then per level (N5, N4, N3) 3 words : 1 grammar point : 1 kanji.
const ENTRIES = [...entriesOf("hira"), ...entriesOf("kata"),
  ...interleave([entriesOf("vocab"), entriesOf("gram5"), entriesOf("kanji")], [3, 1, 1]),
  ...interleave([entriesOf("vocab4"), entriesOf("gram4"), entriesOf("kanji4")], [3, 1, 1]),
  ...interleave([entriesOf("vocab3"), entriesOf("gram3"), entriesOf("kanji3")], [3, 1, 1])];

const todayKey = () => studyDay(); // local YYYY-MM-DD; the study day ends at 4:00
let stats = store.getSync("kp-stats", {});            // "deck:q" -> [hits, misses], free-practice weights
let day = store.getSync("kp-day", { d: todayKey(), n: 0, fresh: 0 });
let history = store.getSync("kp-hist", {}); // "YYYY-MM-DD" -> { reviews, correct } of mature-review answers, { answers } of all
const prefs = { deck: 0, voice: true, ear: false, reverse: false, ...store.getSync("kp-prefs", {}) };
if (!MODES[prefs.deck]) prefs.deck = 0;
let cards = {}; // FSRS state per key, loaded from IndexedDB before the first round
let records = store.getSync("kp-records", {}); // Retos: best score per challenge id
let daily = store.getSync("kp-daily", {}); // Reto del día: "YYYY-MM-DD" -> score of the day's first run
let achvSeen = store.getSync("kp-achv-seen", []); // achievement ids already announced
let kinds = store.getSync("kp-kinds", {}); // listening/reading: [hits, misses]; draw: [sum of scores, drawings]
let profile = { name: "", goal: 20, target: null, targetDate: null, updatedAt: null, ...store.getSync("kp-profile", {}) };
function bumpKind(kind, ok) { const k = (kinds[kind] ??= [0, 0]); k[ok ? 0 : 1]++; store.setSync("kp-kinds", kinds); }
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
  return ENTRIES.filter(e => { const c = cards[e.key]; return c && Date.parse(c.due) <= (c.state === 2 ? end : now); }).length;
};
// Starts a new day (also when the app stays open past midnight) and fixes today's new-card limit.
function rollDay() {
  if (day.d !== todayKey()) day = { d: todayKey(), n: 0, fresh: 0 };
  day.fresh ??= 0;
  if (ready) day.limit = newCardsToday(dueNow(), history, day.d); // live: the brake lifts as the backlog clears
}
rollDay();
// Extra new cards the student asked for today ("5 nuevas más"); the brake still wins at 0.
const newLimit = () => (day.limit === 0 ? 0 : (day.limit ?? NEW_PER_DAY) + (day.bonus ?? 0));
const reviewQueue = () => queue(fromLevel(ENTRIES, cards, prefs.level), cards, new Date(), newLimit() - day.fresh, day.d);
const seenEntries = () => ENTRIES.filter(e => cards[e.key]);
const allEntries = () => [...DECKS, ...ankiDecks].flatMap(deck => deck.items.map(item => ({ key: keyOf(deck, item), item, deck })));
const mistakePool = () => mistakes(allEntries(), stats);
const pending = () => reviewQueue().length;

// Every answer is saved right away; the footer says so (or warns if storage failed).
async function saveCards() {
  const ok = await store.set("kp-cards", cards);
  const text = ok ? "✓ Guardado" : "No se pudo guardar · exporta tu progreso";
  if ($("saved").textContent === text) return;
  $("saved").textContent = text;
  $("saved").classList.toggle("bad", !ok);
  $("saved").setAttribute("aria-live", ok ? "off" : "assertive");
}

// ---------- rendering ----------
function renderTop() {
  rollDay();
  const m = mode();
  $("decktag").textContent = m.name.toUpperCase();
  if (isReview()) {
    $("acc").textContent = `${pending()} pendientes`;
  } else if (m === PRACTICE) {
    $("acc").textContent = `${seenEntries().length} cartas vistas`;
  } else if (m === MISTAKES) {
    $("acc").textContent = `${mistakePool().length} con errores`;
  } else {
    let h = 0, mi = 0;
    for (const it of m.items) { const s = stats[keyOf(m, it)]; if (s) { h += s[0]; mi += s[1]; } }
    $("acc").textContent = h + mi ? `${Math.round((100 * h) / (h + mi))}% aciertos` : "– aciertos";
  }
  $("streak").textContent = "×" + streak;
  $("today").textContent = day.n;
  const grammar = (cur?.deck ?? m).kind === "grammar";
  $("ear").setAttribute("aria-pressed", earOn(cur?.deck ?? m));
  $("reverse").setAttribute("aria-pressed", prefs.reverse);
  $("ear").disabled = grammar || !jaVoice || !prefs.voice;
  $("ear").title = !jaVoice ? "Instala una voz japonesa: Configuración → Hora e idioma → Voz" : !prefs.voice ? "Activa la voz (View) para usar el modo oído" : grammar ? "No aplica en gramática" : "";
  $("reverse").disabled = grammar;
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
    return e ? { item: e.item, deck: e.deck, teach: !cards[e.key] } : null;
  }
  if (mode() === PRACTICE || mode() === MISTAKES) {
    const pool = mode() === PRACTICE ? seenEntries() : mistakePool();
    if (!pool.length) return null;
    const prev = pool.find(e => e.key === lastKey);
    const e = pick(pool, x => stats[x.key], Math.random, prev);
    return { item: e.item, deck: e.deck, teach: false };
  }
  // A single deck teaches each card the first time instead of asking it cold.
  const deck = mode();
  const prev = deck.items.find(i => keyOf(deck, i) === lastKey);
  const k = it => keyOf(deck, it);
  const { item, teach } = pickPractice(deck.items, it => stats[k(it)], it => practiceStatus(stats[k(it)], cards[k(it)]),
    Math.random, prev, !!recent.at(-1)?.taught);
  return { item, deck, teach };
}

function next() {
  clearTimeout(timer);
  studyCard = 0;
  rollDay();
  if (round.results.length >= ROUND) return showSummary();
  cur = nextCard();
  if (!cur) return showSummary();
  lastKey = keyOf(cur.deck, cur.item);
  teaching = cur.teach;
  recent = [...recent.slice(-4), { key: lastKey, t: Date.now(), taught: teaching }];
  renderCard();
}

// Draws the current card in the current mode (also when ear or reverse change mid-question).
function renderCard() {
  const { item, deck } = cur;
  opts = options(deck.items, item, answerField(deck));
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
function countFresh() {
  day.fresh++;
  const h = (history[day.d] ??= { reviews: 0, correct: 0 });
  h.fresh = (h.fresh ?? 0) + 1;
  store.setSync("kp-hist", history);
}

// After a miss the card stays on screen as a mini lesson until the student moves on.
let studyCard = 0; // when the mini lesson after a miss started (0 = none)
const STUDY_MIN_MS = 600; // a double press right after missing must not skip the lesson and answer the next card
function answer(k) {
  if (screen === "play" && studyCard) {
    if (performance.now() - studyCard < STUDY_MIN_MS) return;
    studyCard = 0; next(); return;
  }
  if (screen !== "play" || locked || !cur) return;
  const { item, deck } = cur;
  const key = keyOf(deck, item);
  const field = answerField(deck);
  const chosen = opts[KEYS.indexOf(k)];
  if (teaching) {
    // Only the highlighted answer moves on; any other click or button points at it.
    if (chosen !== item[field]) {
      $("hint").textContent = "Pulsa la respuesta marcada para seguir";
      const right = $("opts").querySelector(".bar.right");
      right?.classList.remove("nudge"); void right?.offsetWidth; right?.classList.add("nudge");
      return;
    }
    locked = true;
    day.n++; countAnswer();
    if (isReview()) {
      countFresh();
      cards[key] = grade(undefined, true, 0);
      saveCards();
    } else {
      // Free practice: the card is now "seen" for this deck, without touching the FSRS calendar.
      stats[key] ??= [0, 0];
      store.setSync("kp-stats", stats);
    }
    store.setSync("kp-day", day);
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
    if (!cards[key]) countFresh();
    else if (cards[key].state === 2) {
      const h = (history[day.d] ??= { reviews: 0, correct: 0 });
      h.reviews++; if (ok) h.correct++;
      store.setSync("kp-hist", history);
    }
    cards[key] = grade(cards[key], ok, ms);
    saveCards();
  }
  streak = ok ? streak + 1 : 0;
  if (prefs.sfx) (ok ? sfx.right : sfx.wrong)();
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
  if (deck.kind !== "grammar") {
    // Reading and meaning together, so a miss teaches the whole card.
    const parts = [item.r && item.r !== item.q ? item.r : "", deck.kind !== "kana" || field === "q" ? item.a : ""].filter(Boolean);
    $("reading").textContent = !ok || item.r ? parts.join(" · ") : "";
  }
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
  $("verdict").scrollIntoView({ block: "nearest" }); // on short phones it sits below the fold
  renderTop(); renderPips();

  if (deck.kind === "kanji") showStrokes(item.q).then(n => {
    if (!n || screen !== "play" || !ok) return;
    clearTimeout(timer);
    timer = setTimeout(next, Math.max(800, n * STROKE_SECONDS * 1000 + 900));
  });
  if (!ok) {
    studyCard = performance.now();
    $("hint").textContent = "Estúdiala un momento · A, o cualquier respuesta, para seguir";
    return;
  }
  timer = setTimeout(next, deck.kind === "grammar" ? 2200 : 800);
}

function showSummary() {
  setTimeout(announceAchievements); // after this result is saved
  screen = "summary";
  sync();
  $("stage").hidden = true; $("summary").hidden = false;
  const hits = round.results.filter(Boolean).length;
  const done = round.results.length;
  reviewDone = false;
  clearTimeout(restTimer);
  if (isReview() && resting) {
    // Count down and continue by itself as soon as the first card has rested.
    const wait = Math.max(1, Math.ceil((Math.min(...recent.slice(-BREATHER_CARDS).map(r => r.t)) + BREATHER_MS - Date.now()) / 1000));
    $("sumtitle").textContent = "Un respiro";
    $("score").textContent = done ? `${hits} / ${done}` : "…";
    $("sumnote").textContent = `Las cartas que quedan acaban de salir. Seguimos solos en ${wait} s. A: practicar lo visto mientras esperas.`;
    restTimer = setTimeout(() => { if (screen === "summary" && isReview()) newRound(); }, wait * 1000);
    reviewDone = true;
  } else if (isReview() && done < ROUND) {
    const nd = nextDue(cards);
    $("sumtitle").textContent = "¡Todo al día!";
    $("score").textContent = done ? `${hits} / ${done}` : "0 pendientes";
    $("sumnote").textContent = (nd ? `Próximo repaso: ${nd.toLocaleString("es", { weekday: "long", hour: "2-digit", minute: "2-digit" })}. ` : "") +
      "Puedes seguir: A practica lo que ya viste (no cambia tu calendario)" + (newLimit() > 0 ? " y X agrega 5 cartas nuevas." : ".");
    reviewDone = true;
  } else {
    $("sumtitle").textContent = "Ronda terminada";
    $("score").textContent = `${hits} / ${done}`;
    $("sumnote").textContent = isReview() ? `Quedan ${pending()} cartas para hoy.`
      : mode() === MISTAKES ? (mistakePool().length ? `Quedan ${mistakePool().length} cartas con errores.` : "No quedan cartas con errores. Cuando falles alguna, vuelve a aparecer aquí.")
      : "";
    if (mode() === MISTAKES && !done) { $("sumtitle").textContent = "Sin errores"; $("score").textContent = "0"; }
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
  $("again").querySelector("span:last-child").textContent = reviewDone ? "Practicar lo visto" : "Otra ronda";
  $("morenew").hidden = !(reviewDone && !resting && newLimit() > 0);
  renderTop();
  $("again").focus();
}

let reviewDone = false, restTimer = 0;
// Summary buttons: A continues (another round, or practice once today's review is done).
function continueStudy() {
  clearTimeout(restTimer);
  if (reviewDone) { prefs.deck = MODES.indexOf(PRACTICE); savePrefs(); lastKey = null; }
  newRound();
}
function moreNew() {
  if (newLimit() === 0) return;
  const base = day.limit ?? NEW_PER_DAY;
  day.bonus = Math.max(day.bonus ?? 0, day.fresh - base) + 5; store.setSync("kp-day", day);
  prefs.deck = MODES.indexOf(REVIEW); savePrefs();
  newRound();
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
  if (name === "ear" && (!jaVoice || !prefs.voice)) {
    if (jaVoice) { $("note").textContent = "El modo oído necesita la voz: actívala con View (o S)."; return; }
    $("note").textContent = "El modo oído necesita una voz japonesa. En Windows: Configuración → Hora e idioma → Voz → Agregar voces → Japonés.";
    return;
  }
  if ((name === "ear" || name === "reverse") && (cur?.deck ?? mode()).kind === "grammar") return;
  prefs[name] = !prefs[name];
  savePrefs(); renderTop();
  if (name === "voice" && !prefs.voice) stopVoice();
  if ((name === "ear" || name === "reverse") && screen === "play" && cur && !locked && !studyCard) renderCard();
}
function setPaused(p) {
  if (p && (screen === "play" || screen === "summary")) {
    resumeTo = screen; pausedAt = performance.now();
    screen = "pause"; clearTimeout(timer); clearTimeout(restTimer);
    openMenu();
  } else if (!p && ready && screen === "pause") {
    screen = resumeTo; closeMenu();
    shownAt += performance.now() - pausedAt; // a pause is not thinking time (it would grade the answer "Hard")
    keepAwake();
    if (screen === "play" && locked) next();
    else if (screen === "summary") showSummary(); // restarts the breather countdown
    // (no auto-focus on an answer bar: its yellow focus ring would look like a hint)
  }
}
let resumeTo = "play", pausedAt = 0;

// Starts studying a mode from the menu (0 = Repaso de hoy, 1 = Práctica de lo visto, 2.. = decks).
function startMode(i) {
  if (!ready) return;
  prefs.deck = i; savePrefs(); streak = 0; lastKey = null;
  screen = "play"; closeMenu();
  keepAwake();
  newRound();
}

// ---------- main menu: category column + panel (§9.1, layout "columna y panel") ----------
// ↑↓ move, A or → enter the panel, B or ← go back to the column; ←→ change a row's value (Ajustes).
const CATS = [
  { id: "hoy", name: "Hoy", icon: "today" }, { id: "practicar", name: "Practicar", icon: "practice" }, { id: "leer", name: "Leer y oír", icon: "read" },
  { id: "retos", name: "Retos", icon: "trophy" }, { id: "progreso", name: "Mi panel", icon: "chart" }, { id: "ajustes", name: "Ajustes", icon: "settings" },
];
const menu = { cat: 0, sel: 0, focus: "panel", sub: null }; // sub: "voices", a page inside Ajustes
let menuPage = null; // category (and sub page) the panel last showed

function accuracyOf(deck) {
  let h = 0, m = 0;
  for (const it of deck.items) { const s = stats[keyOf(deck, it)]; if (s) { h += s[0]; m += s[1]; } }
  return h + m ? `${Math.round((100 * h) / (h + m))}%` : "–";
}

const catCount = id => (id === "hoy" ? pending() : id === "leer" ? newStories() : 0) || "";

// A row: { label, sub, count, group, action, seg: { options, on }, change(d), test, disabled }.
function voiceRows() {
  const ja = allVoices().filter(v => v.lang?.toLowerCase().startsWith("ja"));
  const active = listenVoices(), isOn = v => active.some(a => a.voiceURI === v.voiceURI);
  return ja.map(v => ({
    group: "Voces del listening", label: `${isOn(v) ? "✓" : "○"} ${v.name}`, sub: "A: activar o quitar · X: probar",
    action: () => {
      const on = isOn(v);
      if (on && active.length === 1) { $("msg").textContent = "Debe quedar al menos una voz activa."; return; }
      prefs.listenVoices = (on ? active.filter(a => a.voiceURI !== v.voiceURI) : [...active, v]).map(a => a.voiceURI); savePrefs(); renderMenu();
    },
    test: () => sayWith("こんにちは。カナパッドです。", v),
  }));
}

// Puente con Anki (Ajustes → Anki): AnkiConnect's deck list to import, then the decks already imported.
let ankiList = null; // { loading } | { names } | { error }
function openAnki() {
  menu.sub = "anki"; menu.subRow = menu.sel; menu.sel = 0; ankiList = { loading: true }; renderMenu();
  ankiCall("deckNames").then(names => { ankiList = { names: names.sort() }; }, e => { ankiList = { error: e.message }; })
    .finally(() => { if (menu.sub === "anki") renderMenu(); });
}
async function importAnki(name) {
  $("msg").textContent = `Leyendo «${name}» de Anki…`;
  try {
    const deck = await readDeck(name);
    if (new Set(deck.items.map(i => i.a)).size < 4) { $("msg").textContent = `«${name}» necesita al menos 4 cartas con respuestas distintas.`; return; }
    const at = ankiDecks.findIndex(d => d.id === deck.id);
    if (at < 0) { ankiDecks.push(deck); MODES.push(deck); } else { MODES[MODES.indexOf(ankiDecks[at])] = deck; ankiDecks[at] = deck; }
    store.setSync("kp-anki", ankiDecks);
    // localStorage holds about 5 MB: say so instead of losing the deck on the next start.
    const kept = store.getSync("kp-anki", []).some(d => d.id === deck.id && d.items.length === deck.items.length);
    $("msg").textContent = kept ? `«${name}»: ${deck.items.length} cartas. Está en Practicar → Anki.` : `«${name}» es demasiado grande para guardarlo en este navegador; solo dura esta sesión.`;
  } catch (e) { $("msg").textContent = `No se pudo leer «${name}»: ${e.message}`; }
  renderMenu();
}
function removeAnki(deck) {
  const i = MODES.indexOf(deck);
  if (prefs.deck === i) prefs.deck = 0; else if (prefs.deck > i) prefs.deck--;
  MODES.splice(i, 1); ankiDecks = ankiDecks.filter(d => d !== deck);
  store.setSync("kp-anki", ankiDecks); savePrefs();
  $("msg").textContent = `«${deck.name}» quitado. Tu Anki no cambia.`; renderMenu();
}
function ankiRows() {
  const g = "Mazos de tu Anki";
  const found = ankiList?.loading ? [{ group: g, icon: "download", label: "Conectando con Anki…", disabled: true }]
    : ankiList?.error ? [{ group: g, icon: "info", label: "Anki no responde", action: openAnki,
      sub: `Abre Anki con el complemento AnkiConnect (código 2055492159) y agrega ${location.origin} a webCorsOriginList en su configuración · A: reintentar` }]
    : ankiList.names.map(name => ({ group: g, icon: "download", label: name, action: () => importAnki(name),
      sub: ankiDecks.some(d => d.name === name) ? "Ya importado · A: actualizar" : "A: importar como práctica libre" }));
  return [...found, ...ankiDecks.map(d => ({ group: "Importados", icon: "layers", label: d.name, sub: `${d.items.length} cartas · A: quitar de Kana Pad (tus aciertos se guardan)`, action: () => removeAnki(d) }))];
}

function menuRows() {
  if (menu.sub === "voices") return voiceRows();
  if (menu.sub === "anki") return ankiRows();
  const id = CATS[menu.cat].id, start = prefs.level ?? "kana";
  if (id === "hoy") {
    const limit = day.limit ?? NEW_PER_DAY;
    return [
      ...(screen === "pause" ? [{ icon: "play", label: "Continuar", sub: "Volver a donde estabas", action: () => setPaused(false) }] : []),
      { icon: "layers", label: "Repaso de hoy", count: String(pending()), action: () => startMode(0),
        sub: `${pending()} pendientes · ${day.fresh} de ${newLimit()} nuevas · desde ${levelName(start)}` + (limit < NEW_PER_DAY ? " · FRENO: hoy entran menos nuevas" : "") },
      // A reminder while it's pending; once done it lives in Retos with its score.
      ...(daily[day.d] === undefined ? [{ ...dailyRow(), group: undefined }] : []),
      ...(!prefs.level ? [{ icon: "stairs", label: "Prueba de nivel", sub: "Unas preguntas para saber desde dónde empezar", action: startPlacement }] : []),
    ];
  }
  if (id === "practicar") {
    const order = [start, ...LEVELS.map(l => l.id).filter(l => l !== start)];
    return [
      { icon: "layers", label: "Todo lo visto", count: String(seenEntries().length), sub: "Sin cartas nuevas · no cambia tu calendario", action: () => startMode(1) },
      { icon: "undo", label: "Mis errores", count: String(mistakePool().length || ""), action: () => startMode(MODES.indexOf(MISTAKES)),
        sub: mistakePool().length ? `Las ${mistakePool().length} cartas que más fallas · no cambia tu calendario` : "Aún no hay cartas con errores" },
      { icon: "pen", label: "Dibujar", sub: "Kana y kanji con el dedo o el ratón, con calificación", action: startDraw },
      ...order.flatMap(lv => DECKS.flatMap((d, i) => {
        if (d.level !== lv) return [];
        const acc = accuracyOf(d), tried = acc !== "–";
        return [{ group: levelName(lv) + (lv === start ? " · tu nivel" : ""), label: d.name, count: tried ? acc : "",
          sub: `${d.items.length} cartas` + (tried ? ` · ${acc} de aciertos` : " · sin practicar"), action: () => startMode(i + 2) }];
      })),
      ...ankiDecks.map(d => {
        const acc = accuracyOf(d);
        return { group: "Anki", icon: "layers", label: d.name, count: acc === "–" ? "" : acc, action: () => startMode(MODES.indexOf(d)),
          sub: `${d.items.length} cartas de Anki` + (acc === "–" ? " · sin practicar" : ` · ${acc} de aciertos`) };
      }),
    ];
  }
  if (id === "leer") return [
    { icon: "book", label: "Cuentos", count: newStories() ? String(newStories()) : "", sub: `${STORIES_N5.length} cuentos · ${newStories()} sin leer · guarda palabras mientras lees`, action: openStories },
    { icon: "headphones", label: "Listening", sub: `Escucha y elige qué dijo la voz · ${listenVoices().length} voces activas`, action: startListening },
  ];
  if (id === "retos") {
    const best = id => (records[id] ? `Récord: ${records[id]}` : "Sin récord todavía");
    const sim = lv => {
      const prev = exams.findLast(x => (x.lv ?? "n5") === lv), n = lv === "n5" ? 30 : 20;
      return { group: "Simulacros", icon: "exam", label: `Simulacro ${levelName(lv)}`, action: () => startExam(lv),
        sub: (prev ? `Último: ${prev.right}/${prev.total} · ${prev.pass ? "aprobado" : "no aprobado"} · ` : "") + `${examMinutes(n)} minutos, ${n} preguntas` + (lv === "n5" ? "" : " · sin lectura") };
    };
    return [
      dailyRow(),
      { group: "Retos rápidos", icon: "timer", label: "Contrarreloj", sub: `${best("time")} · 60 segundos: todas las que puedas`, action: () => startChallenge("time") },
      { group: "Retos rápidos", icon: "heart", label: "Supervivencia", sub: `${best("survival")} · hasta el primer fallo`, action: () => startChallenge("survival") },
      sim("n5"), sim("n4"), sim("n3"),
    ];
  }
  if (id === "progreso") {
    const u = cloud.user();
    return [
      { icon: "chart", label: "Ver mi panel", count: String(streakDays(history, day.d, true)), sub: "Racha y calendario, niveles, precisión y próximos 7 días", action: () => openProgress("resumen") },
      { icon: "user", label: "Perfil y cuenta", sub: u ? `Sincronizado con ${u.email}` : "Nombre, meta diaria, nivel objetivo y sincronizar entre dispositivos", action: () => openProgress("cuenta") },
    ];
  }
  const lv = Math.max(0, LEVELS.findIndex(l => l.id === start));
  const setLevel = d => {
    const to = Math.max(0, Math.min(LEVELS.length - 1, lv + d));
    if (to === lv) return false;
    prefs.level = LEVELS[to].id; savePrefs(); renderMenu();
  };
  const voice = () => { toggle("voice"); renderMenu(); };
  const voiceTo = d => { if ((d < 0) === prefs.voice) return false; voice(); }; // ← SÍ, → NO
  // Turning effects on plays one, so the student hears how loud they are.
  const effects = () => { toggle("sfx"); if (prefs.sfx) sfx.right(); renderMenu(); };
  const effectsTo = d => { if ((d < 0) === !!prefs.sfx) return false; effects(); };
  return [
    { group: "Voz", icon: "speaker", label: "Leer cada carta en voz alta", seg: { options: ["SÍ", "NO"], on: prefs.voice ? 0 : 1 }, action: voice, change: voiceTo },
    { group: "Voz", icon: prefs.sfx ? "speaker" : "mute", label: "Efectos de sonido", sub: "Acierto, fallo y récord · volumen bajo", seg: { options: ["SÍ", "NO"], on: prefs.sfx ? 0 : 1 }, action: effects, change: effectsTo },
    { group: "Voz", icon: "headphones", label: "Voces del listening", sub: `${listenVoices().length} activas`, count: "›", action: openVoices },
    ...(tauri ? [] : [{ group: "Voz", id: "voicesdl", icon: "download", label: "Voces sin conexión", sub: voicesDlText(), action: downloadVoices }]),
    { group: "Anki", icon: "upload", label: "Importar de Anki", sub: ankiDecks.length ? `${ankiDecks.length} mazos importados · necesita Anki abierto con AnkiConnect` : "Practica tus mazos de Anki aquí · necesita Anki abierto con AnkiConnect", count: "›", action: openAnki },
    { group: "Nivel", icon: "stairs", label: "Punto de partida", sub: "Desde dónde entran cartas nuevas al repaso", seg: { options: LEVELS.map(l => l.name.toUpperCase()), on: lv }, action: () => setLevel(lv === LEVELS.length - 1 ? -lv : 1), change: setLevel },
    { group: "Nivel", icon: "exam", label: "Repetir prueba de nivel", sub: "Unas preguntas por nivel", action: startPlacement },
    { group: "Mando y datos", icon: "pad", label: "Usar otro mando", sub: "Después pulsa un botón en el mando nuevo", action: () => { pad.reset(); $("msg").textContent = "Pulsa un botón en el mando que quieras usar."; } },
    { group: "Mando y datos", icon: "download", label: "Exportar progreso", sub: "Guarda una copia en un archivo", action: exportProgress },
    ...(pendingImport ? [
      { group: "Mando y datos", icon: "check", label: "Confirmar importación", sub: `Reemplaza tus ${Object.keys(cards).length} cartas en repaso por las ${Object.keys(pendingImport.r.cards).length} de «${pendingImport.name}»`, action: confirmImport },
      { group: "Mando y datos", icon: "close", label: "Cancelar importación", sub: "Tu progreso no cambia", action: () => { pendingImport = null; $("msg").textContent = ""; renderMenu(); } },
    ] : [{ group: "Mando y datos", icon: "upload", label: "Importar progreso", sub: "Elige un archivo exportado; antes de reemplazar nada te pide confirmación", action: () => $("import").click() }]),
    ...(store.getSync("kp-preimport", null) ? [{ group: "Mando y datos", icon: "undo", label: "Deshacer la última importación", sub: "Vuelve al progreso que tenías antes", action: undoImport }] : []),
    { group: "Mando y datos", icon: "info", label: "Fuentes y licencias", sub: "KanjiVG, KANJIDIC2, JMdict, Kokoro, ts-fsrs y tipografías", action: () => { $("credits").hidden = !$("credits").hidden; } },
  ];
}

function renderMenu() {
  rollDay();
  const rows = menuRows();
  menu.sel = Math.max(0, Math.min(menu.sel, rows.length - 1));
  const meta = el("span"); const days = streakDays(history, day.d, true);
  meta.append("Nivel ", el("b", "", prefs.level ? levelName(prefs.level) : "—"), ` · ${days} ${days === 1 ? "día seguido" : "días seguidos"}`);
  $("menulevel").replaceChildren(meta);
  const atHome = menu.cat === 0 && !menu.sub;
  $("overlay").querySelector("[data-nav=back]").hidden = atHome && screen !== "pause"; // nothing behind the home screen
  $("overlay").querySelector("[data-nav=home]").hidden = atHome;
  $("menurail").replaceChildren(...CATS.map((c, i) => {
    const b = el("button", "menu-item" + (i !== menu.cat ? "" : menu.focus === "rail" ? " sel" : " on"));
    b.type = "button";
    b.insertAdjacentHTML("beforeend", icon(c.icon));
    b.append(el("span", "mlabel", c.name));
    const n = catCount(c.id);
    if (n) b.append(el("span", "mcount", String(n)));
    b.addEventListener("click", () => { menu.cat = i; menu.sel = 0; menu.sub = null; menu.focus = "rail"; $("credits").hidden = true; renderMenu(); });
    return b;
  }));
  $("menupanel").classList.toggle("active", menu.focus === "panel");
  // A new category slides its rows in; moving inside the same one only moves the highlight.
  const page = menu.cat + (menu.sub ?? "");
  if (page !== menuPage) { menuPage = page; $("menupanel").classList.remove("swap"); void $("menupanel").offsetWidth; $("menupanel").classList.add("swap"); }
  let group = null;
  $("menupanel").replaceChildren(...rows.flatMap((it, i) => {
    const out = [];
    if (it.group && it.group !== group) out.push(el("p", "mgroup", (group = it.group).toUpperCase()));
    const b = el("button", "mrow" + (menu.focus === "panel" && i === menu.sel ? " sel" : ""));
    b.type = "button";
    if (it.id) b.dataset.row = it.id;
    if (it.disabled) b.setAttribute("aria-disabled", "true");
    if (it.icon) b.insertAdjacentHTML("beforeend", icon(it.icon));
    const label = el("span", "mlabel"); label.append(el("span", "", it.label));
    if (it.sub) label.append(el("span", "msub", it.sub));
    b.append(label);
    if (it.seg) { const s = el("span", "seg"); s.append(...it.seg.options.map((o, k) => el("span", k === it.seg.on ? "on" : "", o))); b.append(s); }
    if (it.count) b.append(el("span", "mcount", it.count));
    b.addEventListener("click", () => { menu.focus = "panel"; menu.sel = i; activateMenu(); });
    out.push(b);
    return out;
  }));
  // Today at a glance on the blue slab, like the profile card in Mi panel.
  const goal = profile.goal || 20, today = el("div", "meter"), fill = el("i");
  fill.style.width = `${Math.min(100, (100 * day.n) / goal)}%`; today.append(fill);
  const big = el("p", "mbig"); big.append(el("b", "", String(pending())), pending() === 1 ? "repaso pendiente" : "repasos pendientes");
  const streakLine = el("p", "pmeta"); streakLine.append("Nivel ", el("b", "", prefs.level ? levelName(prefs.level) : "—"), " · ");
  streakLine.insertAdjacentHTML("beforeend", icon("flame"));
  streakLine.append(" Racha ", el("b", "", String(days)), " · nuevas ", el("b", "", `${day.fresh}/${newLimit()}`));
  // This week at a glance (Monday first): which days had answers; the streak number is the line above.
  const week = el("p", "mweek"); week.setAttribute("aria-label", "Esta semana");
  week.append(...heatmap(history, day.d, 1).map((c, i) => {
    const d = el("i", c.n === null ? "future" : c.n ? "on" : ""); if (c.d === day.d) d.classList.add("today");
    d.append(el("span", "", "LMXJVSD"[i])); d.title = fmtDate(c.d); return d;
  }));
  const h = new Date().getHours(), hello = h >= 6 && h < 12 ? "Buenos días" : h >= 12 && h < 20 ? "Buenas tardes" : "Buenas noches";
  $("menuhero").replaceChildren(el("p", "mhello", profile.name ? `${hello}, ${profile.name}` : hello), big, streakLine, week, el("p", "peta", `Hoy: ${day.n} de ${goal} respuestas`), today);
  $("menuhero").hidden = CATS[menu.cat].id !== "hoy" || !!menu.sub; // the slab belongs to Hoy, not to every page
  const focused = menu.focus === "rail" ? $("menurail").children[menu.cat] : $("menupanel").querySelectorAll(".mrow")[menu.sel];
  focused?.focus({ preventScroll: true });
  focused?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function moveMenu(d) {
  $("overlay").classList.remove("intro");
  if (menu.focus === "rail") { menu.cat = (menu.cat + d + CATS.length) % CATS.length; menu.sel = 0; menu.sub = null; $("credits").hidden = true; }
  else { const n = menuRows().length; menu.sel = (menu.sel + d + n) % n; }
  renderMenu();
}
function menuSide(d) {
  if (menu.focus === "rail") { if (d > 0) enterPanel(); return; }
  const it = menuRows()[menu.sel];
  if (it?.change && it.change(d) !== false) return;
  if (d < 0) menuBack();
}
function enterPanel() { menu.focus = "panel"; menu.sel = 0; renderMenu(); }
function activateMenu() {
  if (menu.focus === "rail") return enterPanel();
  const it = menuRows()[menu.sel];
  if (!it || it.disabled) return;
  it.action();
}
function openVoices() { menu.cat = CATS.findIndex(c => c.id === "ajustes"); menu.focus = "panel"; menu.sub = "voices"; menu.subRow = menu.sel; menu.sel = 0; renderMenu(); }
function menuBack() {
  if (menu.sub) { menu.sub = null; menu.sel = menu.subRow ?? 0; renderMenu(); } // back onto the row that opened it
  else if (menu.focus === "panel") { menu.focus = "rail"; $("credits").hidden = true; renderMenu(); }
  else if (screen === "pause") setPaused(false);
}
function openMenu() {
  setTimeout(announceAchievements); // anything earned since, e.g. through a sync
  wakeLock?.release().catch(() => {}); wakeLock = null;
  Object.assign(menu, { cat: 0, sel: 0, focus: "panel", sub: null }); $("credits").hidden = true;
  $("overlay").hidden = false; document.querySelector(".app").inert = true;
  // The staggered entrance runs once per opening, not on every rebuild while moving (rows are recreated).
  $("overlay").classList.add("intro"); setTimeout(() => $("overlay").classList.remove("intro"), 450);
  renderMenu(); renderBackupReminder();
}
function closeMenu() { $("overlay").hidden = true; document.querySelector(".app").inert = false; }

function speak(text) {
  if (prefs.voice) say(text, listenVoices()[0], { rate: 0.85 });
}

// Offline voices: every clip of every built-in voice is downloaded once, in the background, into the
// cache the service worker answers from (sw.js, AUDIO). Desktop/Android builds ship the files already.
const AUDIO_CACHE = "kana-pad-audio";
const voicesDl = { done: 0, total: 0, missed: 0, state: "idle" }; // idle | running | done | offline | full
function voicesDlText() {
  const pct = voicesDl.total ? Math.floor((100 * voicesDl.done) / voicesDl.total) : 0;
  return { idle: "Preparando la descarga…", running: `Descargando: ${pct} % (${voicesDl.done} de ${voicesDl.total})`,
    done: voicesDl.missed ? `Faltan ${voicesDl.missed} clips; A para reintentar` : "Listas: funcionan sin conexión", offline: `Pausada sin conexión en ${pct} %; sigue al volver a abrir la app`,
    full: `No hay espacio en el dispositivo; se guardó el ${pct} %` }[voicesDl.state];
}
function showVoicesDl() {
  const row = document.querySelector("#menupanel [data-row='voicesdl'] .msub");
  if (row) row.textContent = voicesDlText();
}
async function downloadVoices() {
  if (tauri || !("caches" in window) || voicesDl.state === "running") return;
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict ~73 MB of clips
  const cache = await caches.open(AUDIO_CACHE);
  const have = new Set((await cache.keys()).map(r => r.url));
  const urls = Object.keys(allTexts()).flatMap(h => BUILT_IN.map(v => new URL(clipPath(v, h), location.href).href));
  const todo = urls.filter(u => !have.has(u));
  Object.assign(voicesDl, { total: urls.length, done: urls.length - todo.length, missed: 0, state: todo.length ? "running" : "done" });
  showVoicesDl();
  let next = 0, shown = 0;
  const worker = async () => {
    while (next < todo.length && voicesDl.state === "running") {
      const u = todo[next++];
      // A busy server sometimes drops a request: retry with a pause; stop only when the device is offline.
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved && voicesDl.state === "running"; attempt++) {
        try {
          const res = await fetch(u, { cache: "no-store" });
          if (res.status === 200) { await cache.put(u, res); saved = true; }
        } catch (e) {
          if (e?.name === "QuotaExceededError") voicesDl.state = "full";
          else if (!navigator.onLine) voicesDl.state = "offline";
        }
        if (!saved) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
      if (saved) voicesDl.done++;
      else if (voicesDl.state === "running") voicesDl.missed++; // that clip falls back to the system voice
      if (voicesDl.done - shown >= 50) { shown = voicesDl.done; showVoicesDl(); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (voicesDl.state === "running") voicesDl.state = "done";
  showVoicesDl();
}

// Built-in voices play a pre-generated clip; system voices use speechSynthesis.
// A clip that isn't there (text added after the last generate) falls back to a system voice.
const clip = new Audio();
function stopVoice() { clip.pause(); window.speechSynthesis?.cancel(); }
function say(text, voice, { rate = 1, pitch = 1, wave = false } = {}) {
  stopVoice();
  const on = () => wave && $("lwave").classList.add("on"), off = () => wave && $("lwave").classList.remove("on");
  const system = v => {
    if (!window.speechSynthesis) return off();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = "ja-JP"; u.rate = rate; u.pitch = pitch;
    try { if (v) u.voice = v; } catch {} // a voice that went away falls back to the default Japanese one
    u.onstart = on; u.onend = u.onerror = off;
    speechSynthesis.speak(u);
  };
  if (!voice?.builtin) return system(voice);
  clip.src = clipUrl(voice, speakable(text));
  clip.playbackRate = rate < 0.8 ? 0.75 : 1; // the clips are already at a learner's pace
  clip.onplaying = on; clip.onended = off;
  clip.onerror = () => system(window.speechSynthesis?.getVoices().find(v => v.lang.startsWith("ja")));
  clip.play().catch(() => {}); // autoplay refusals and aborted loads are reported via onerror or ignored
}

// Keeps the screen on during cardio; the browser may refuse, which is fine.
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") sync();
  // The browser drops the lock whenever the tab is hidden.
  if (document.visibilityState === "visible" && screen === "play" && (!wakeLock || wakeLock.released)) keepAwake();
});

// ---------- user dashboard ("Mi panel") ----------
const TABS = ["resumen", "logros", "niveles", "precision", "pron", "cuenta"];
let tab = "resumen";
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmtDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
const meterRow = (cls, label, frac, right) => {
  const row = el("div", cls);
  const meter = el("div", "meter"); const fill = el("i"); fill.style.width = `${Math.round(100 * Math.min(1, frac))}%`; meter.append(fill);
  row.append(el("span", "", label), meter, el("small", "", right));
  return row;
};

function emptyState(ico, title, text) {
  const box = el("div", "empty"), mark = el("span", "emptyicon");
  mark.innerHTML = icon(ico);
  box.append(mark, el("p", "emptytitle", title), el("p", "emptytext", text));
  return box;
}
const achievementList = () => achievements({ history, cards, decks: deckStats(DECKS, cards), exams, stories: storyScores, records, daily, goal: profile.goal || 20 });

// "¡Logro!" toast for achievements done since the last announcement. Only on result screens and the menu,
// never during a question; it doesn't take the focus and hides by itself.
let toastTimer;
function announceAchievements() {
  const fresh = unseen(achievementList(), achvSeen);
  if (!fresh.length) return;
  achvSeen = [...achvSeen, ...fresh.map(a => a.id)]; store.setSync("kp-achv-seen", achvSeen);
  if (prefs.sfx) sfx.win();
  const t = $("toast");
  t.innerHTML = icon("medal");
  t.append(el("b", "", fresh.length === 1 ? "¡LOGRO!" : `${fresh.length} LOGROS NUEVOS`), ...(fresh.length === 1 ? [el("span", "", fresh[0].name)] : []));
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
// Mi panel has nothing to focus inside the tabs, so ↑↓ scroll it (a pad can't reach a long tab otherwise).
function scrollProgress(d) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("progress").scrollBy({ top: d * innerHeight * 0.4, behavior: reduce ? "auto" : "smooth" });
}

// "Tu semana": the last 7 days against the 7 before; nothing until there is something to compare.
function weekBox() {
  const { now, prev } = weekSummary(history, day.d);
  if (!now.answers && !prev.answers) return [];
  const delta = (a, b, unit = "") => a === b ? "igual que la anterior" : `${a > b ? "▲" : "▼"} ${Math.abs(a - b)}${Math.abs(a - b) === 1 ? unit.replace(/s$/, "") : unit} vs. la anterior`;
  const pct = r => (r === null ? null : Math.round(r * 100));
  const cell = (value, label, change, up) => {
    const c = el("div", "wk"); c.append(el("b", "", value), el("span", "", label));
    if (change) c.append(el("small", up ? "up" : "", change));
    return c;
  };
  const box = el("div", "weekbox"), grid = el("div", "wgrid");
  grid.append(
    cell(String(now.answers), "respuestas", delta(now.answers, prev.answers), now.answers > prev.answers),
    cell(`${now.days}/7`, "días con estudio", delta(now.days, prev.days), now.days > prev.days),
    cell(String(now.fresh), "cartas nuevas", delta(now.fresh, prev.fresh), now.fresh > prev.fresh),
    cell(pct(now.retention) === null ? "—" : `${pct(now.retention)}%`, "retención",
      pct(now.retention) !== null && pct(prev.retention) !== null ? delta(pct(now.retention), pct(prev.retention), " pts") : "", pct(now.retention) > pct(prev.retention)),
  );
  box.append(el("p", "mgroup", "TU SEMANA · ÚLTIMOS 7 DÍAS"), grid);
  if (now.best) box.append(el("p", "wbest", `Mejor día: ${new Date(now.best.d + "T12:00:00").toLocaleDateString("es", { weekday: "long", day: "numeric" })} · ${now.best.n} respuestas`));
  return [box];
}

function renderProgress() {
  rollDay();
  const P = $("progress");
  // Profile on the slab: name, level, goal for today and when the target level is done at this pace.
  const lv = prefs.level ? levelName(prefs.level) : "—", goal = profile.goal || 20;
  const meta = el("p", "pmeta"); meta.append("Nivel ", el("b", "", lv), " · meta ", el("b", "", String(goal)), " al día");
  const today = el("div", "meter"); const fill = el("i"); fill.style.width = `${Math.min(100, (100 * day.n) / goal)}%`; today.append(fill);
  const card = [el("p", "pname", profile.name || "Estudiante"), meta, el("p", "peta", `Hoy: ${day.n} de ${goal}${day.n >= goal ? " · ¡meta cumplida!" : ""}`), today];
  if (profile.target) {
    const e = eta(fromLevel(ENTRIES, cards, prefs.level), cards, history, day.d, profile.target, newLimit() || NEW_PER_DAY);
    const name = levelName(profile.target);
    let line = !e ? "" : e.remaining === 0 ? `Ya viste todo ${name}.` : `A este ritmo terminas ${name} el ${fmtDate(e.date)} (${e.remaining} cartas, ${e.pace.toFixed(1)} nuevas al día).`;
    if (e?.remaining && profile.targetDate) line += e.date <= profile.targetDate ? ` Llegas antes del ${fmtDate(profile.targetDate)}.` : ` Para el ${fmtDate(profile.targetDate)} te faltarían ${Math.ceil(e.remaining - e.pace * Math.max(0, (Date.parse(profile.targetDate) - Date.parse(day.d)) / 864e5))} cartas.`;
    card.push(el("p", "peta", line));
  } else card.push(el("p", "peta", "Elige un nivel objetivo en Cuenta para ver cuándo llegas."));
  $("pcard").replaceChildren(...card);

  const ret = retention(history, day.d), { n: streakN, saved } = streakRun(history, day.d, true);
  const kpi = (value, label) => { const d = el("div", "kpi"); d.append(el("b", "", value), el("span", "", label)); return d; };
  $("kpis").replaceChildren(
    kpi(String(streakN), (streakN === 1 ? "día seguido" : "días seguidos") + (saved ? " · salvada con tu día libre" : " · 1 día libre por semana")),
    kpi(ret === null ? "—" : `${Math.round(ret * 100)}%`, "retención de cartas maduras (3 días)"),
    kpi(`${day.fresh}/${day.limit ?? NEW_PER_DAY}`, "cartas nuevas hoy"),
    kpi(String(Object.keys(cards).length), "cartas en repaso"),
  );
  // Activity calendar: color by answers relative to the daily goal.
  const cells = heatmap(history, day.d);
  $("heat").replaceChildren(...cells.map(c => {
    const i = el("i");
    if (c.n === null) i.className = "future";
    else { const lvl = c.n === 0 ? 0 : c.n >= goal ? 4 : c.n >= goal / 2 ? 3 : c.n >= goal / 4 ? 2 : 1; i.className = `h${lvl}` + (c.d === day.d ? " today" : ""); }
    i.title = c.n === null ? "" : `${fmtDate(c.d)}: ${c.n} ${c.n === 1 ? "respuesta" : "respuestas"}`;
    return i;
  }));
  $("heat").setAttribute("aria-label", `Actividad de las últimas 16 semanas: ${cells.filter(c => c.n).length} días con estudio.`);
  const notes = [];
  const last = exams.at(-1);
  if (last) notes.push(el("p", "notice pexam",
    `Último simulacro ${levelName(last.lv ?? "n5")} (${last.d}): ${last.right}/${last.total} · ${last.pass ? "Aprobado" : "No aprobado"} — vocabulario ${last.per?.vocab?.join("/") ?? "–"}, gramática ${last.per?.gram?.join("/") ?? "–"}` + (last.per?.read?.[1] ? `, lectura ${last.per.read.join("/")}.` : ".")));
  const limit = day.limit ?? NEW_PER_DAY;
  if (limit < NEW_PER_DAY) {
    const why = el("p", "notice pbrake");
    why.append(el("span", "tag-brake", "FRENO"), limit === 0
      ? `Hoy no entran cartas nuevas: tienes más de 200 repasos pendientes. Haz solo "Repaso de hoy" hasta bajar de 100 y las nuevas vuelven solas.`
      : dueNow() > 100
        ? `Hoy entran ${limit} cartas nuevas en vez de ${NEW_PER_DAY}: tienes más de 100 repasos pendientes. Repasa primero y el límite sube solo.`
        : `Hoy entran ${limit} cartas nuevas en vez de ${NEW_PER_DAY}: aciertas menos del 70% de las cartas maduras. Unos días repasando sin prisa lo corrigen.`);
    notes.push(why);
  }
  $("notices").replaceChildren(...weekBox(), ...notes);

  // No history yet: an empty state takes the calendar's band.
  P.querySelector(".heatbox").hidden = !Object.keys(history).length;
  $("notices").prepend(...(Object.keys(history).length ? [] : [emptyState("calendar", "Todavía no hay datos", "Haz tu primer Repaso de hoy (Hoy → A) y aquí verás tu semana.")]));

  // Achievements, grouped; unlocked ones on the blue slab, locked ones with their progress.
  const achs = achievementList(), groups = { constancia: "CONSTANCIA", volumen: "VOLUMEN", dominio: "DOMINIO", retos: "RETOS" };
  const head = el("div", "achhead"); head.append(el("b", "", String(achs.filter(a => a.done).length)), el("span", "", `de ${achs.length} logros`));
  P.querySelector("[data-panel=logros]").replaceChildren(head, ...Object.entries(groups).flatMap(([g, name]) => {
    const grid = el("div", "achgrid");
    grid.append(...achs.filter(a => a.group === g).map(a => {
      const card = el("article", "ach" + (a.done ? " done" : ""));
      const [n, of] = a.progress;
      card.setAttribute("aria-label", `${a.name}: ${a.desc}, ${a.done ? "conseguido" : `${n} de ${of}`}`);
      card.insertAdjacentHTML("beforeend", icon(!a.done && n === 0 ? "lock" : a.icon));
      card.append(el("p", "aname", a.name), el("p", "adesc", a.desc));
      if (!a.done) { const m = el("div", "meter"), f = el("i"); f.style.width = `${Math.round((100 * n) / of)}%`; m.append(f); card.append(m, el("small", "", `${n}/${of}`)); }
      return card;
    }));
    return [el("p", "mgroup", name), grid];
  }));

  // Levels: one bar per level, then its decks.
  const decksOf = deckStats(DECKS, cards);
  P.querySelector("[data-panel=niveles]").replaceChildren(...levelProgress(DECKS, cards, LEVELS).flatMap(l => [
    meterRow("drow lrow", `${l.name}${l.id === prefs.level ? " · tu nivel" : ""}`, l.seen / l.total, `${l.seen}/${l.total} · ${l.mature} maduras`),
    ...decksOf.filter(d => DECKS.find(x => x.id === d.id).level === l.id)
      .map(d => meterRow("drow", d.name, d.seen / d.total, `${d.seen}/${d.total} · ${d.mature} maduras`)),
  ]));

  // Accuracy by kind and the cards missed most.
  $("pkinds").replaceChildren(...kindAccuracy(DECKS, stats, kinds).map(k =>
    meterRow("drow", k.name, k.rate ?? 0, k.rate === null ? "sin datos" : `${Math.round(100 * k.rate)}% · ${k.total}`)));
  const weak = weakest(DECKS, stats);
  P.querySelector("[data-panel=precision]").querySelector(".empty")?.remove();
  if (!Object.keys(stats).length) P.querySelector("[data-panel=precision]").prepend(emptyState("practice", "Sin respuestas todavía", "Cuando respondas cartas, aquí verás qué tipo aciertas más y cuáles fallas."));
  $("pweak").replaceChildren(...(weak.length ? weak.map(w => {
    const li = el("li"); const jp = el("span", "jp", w.q); jp.lang = "ja";
    li.append(jp, ` ${w.a} · ${w.deck} · ${w.misses} fallos de ${w.hits + w.misses}`);
    return li;
  }) : [el("li", "", "Todavía no hay cartas que falles a menudo.")]));

  const ends = Array.from({ length: 7 }, (_, i) => { const e = dayEnd(); e.setDate(e.getDate() + i); return e; });
  const counts = forecast(cards, ends), max = Math.max(1, ...counts);
  P.querySelector("[data-panel=pron]").replaceChildren(...(!Object.keys(cards).length
    ? [emptyState("layers", "Nada en repaso todavía", "Las cartas que aprendas en Repaso de hoy aparecerán aquí el día que les toque.")] : counts.map((n, i) =>
    meterRow("frow", i === 0 ? "hoy" : new Date(ends[i].getTime() - 5 * 3600e3).toLocaleDateString("es", { weekday: "short", day: "numeric" }), n / max, `${n} ${n === 1 ? "carta" : "cartas"}`))));

  $("pname").value = profile.name; $("pgoal").value = profile.goal; $("ptarget").value = profile.target ?? ""; $("pdate").value = profile.targetDate ?? "";
  renderAccount();
}

function setTab(t) {
  tab = TABS[(TABS.indexOf(t) + TABS.length) % TABS.length];
  for (const b of $("progress").querySelectorAll(".tab")) {
    b.setAttribute("aria-selected", b.dataset.tab === tab);
    if (b.dataset.tab === tab && $("progress").contains(document.activeElement)) b.focus();
  }
  for (const p of $("progress").querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
}
function openProgress(start = "resumen") {
  if (screen !== "pause" && screen !== "start") return;
  progressFrom = screen; screen = "progress";
  renderProgress(); setTab(start);
  $("overlay").hidden = true; $("progress").hidden = false;
  $("progress").querySelector(".tab").focus();
  if (start === "resumen" && !kpisCounted) { kpisCounted = true; for (const b of $("kpis").querySelectorAll("b")) countUp(b); }
}
// The KPI figures count up the first time the panel opens in a session; afterwards they just show.
let kpisCounted = false;
function countUp(b) {
  const m = /^(\d+)(.*)$/.exec(b.textContent); // "12", "87%", "3/15"; "—" is left alone
  if (!m || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const end = Number(m[1]), t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / 700);
    b.textContent = Math.round(end * (1 - (1 - k) ** 3)) + m[2]; // ease-out cubic
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let progressFrom = "start";
function closeProgress() {
  screen = progressFrom;
  $("progress").hidden = true; $("overlay").hidden = false;
  renderMenu();
}
for (const b of $("progress").querySelectorAll(".tab")) b.addEventListener("click", () => setTab(b.dataset.tab));

$("pform").addEventListener("submit", e => {
  e.preventDefault();
  const goal = Math.round(Number($("pgoal").value));
  if (!(goal >= 1 && goal <= 500)) { $("pmsg").textContent = "La meta diaria va de 1 a 500 respuestas."; return; }
  profile = { name: $("pname").value.trim().slice(0, 40), goal, target: $("ptarget").value || null, targetDate: $("pdate").value || null, updatedAt: new Date().toISOString() };
  store.setSync("kp-profile", profile);
  $("pmsg").textContent = cloud.user() ? "Guardado. Se sincroniza con tu cuenta." : "Guardado en este dispositivo.";
  renderProgress(); sync();
});

const login = { step: "signin", email: "" }; // signin | signup
let syncState = { ok: null, at: null, msg: "" };
function renderAccount() {
  const box = $("acct"), u = cloud.user();
  const btn = (label, fn) => { const b = el("button", "bar primary"); b.type = "button"; b.append(el("span", "", label)); b.addEventListener("click", fn); return b; };
  if (u) {
    const st = el("p", "sync"); st.append(el("i", syncState.ok === true ? "ok" : syncState.ok === false ? "bad" : ""),
      syncState.ok === false ? `No se pudo sincronizar: ${syncState.msg}` : syncState.at ? `Sincronizado ${new Date(syncState.at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : "Sin sincronizar todavía");
    const row = el("div", "row");
    row.append(btn("Sincronizar ahora", () => sync(true)), btn("Cerrar sesión", async () => { await cloud.signOut(); syncState = { ok: null, at: null, msg: "" }; renderAccount(); renderMenu(); }));
    box.replaceChildren(el("p", "mgroup", "CUENTA"), el("p", "", `Sesión iniciada como ${u.email}.`), st,
      el("p", "small", "Tu progreso y tu perfil se sincronizan entre la web, Windows, Linux y Android al abrir la app y al terminar cada ronda. Si estudiaste en dos dispositivos, se combinan carta por carta."), row);
    return;
  }
  const msg = el("p", "small"); msg.id = "amsg"; msg.setAttribute("aria-live", "polite");
  const field = (type, auto, ph, value = "") => { const f = document.createElement("input"); f.type = type; f.autocomplete = auto; f.placeholder = ph; f.value = value; return f; };
  const input = field("email", "email", "tu@correo.com", login.email);
  const pass = field("password", login.step === "signup" ? "new-password" : "current-password", "Contraseña (8 o más caracteres)");
  const go = async () => {
    const email = input.value.trim(), password = pass.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Escribe un correo válido."; return; }
    if (password.length < 8) { msg.textContent = "La contraseña necesita 8 caracteres o más."; return; }
    login.email = email;
    msg.textContent = login.step === "signup" ? "Creando la cuenta…" : "Entrando…";
    try {
      if (login.step === "signup") {
        if (await cloud.signUp(email, password)) {
          login.step = "signin"; renderAccount();
          $("amsg").textContent = `Te enviamos un correo a ${email}. Abre su enlace para confirmar la cuenta (si la página a la que lleva no carga, no importa: la cuenta queda confirmada) y luego entra aquí.`;
          return;
        }
      } else await cloud.signIn(email, password);
      login.step = "signin"; renderAccount(); renderMenu(); sync(true);
    } catch (e) {
      msg.textContent = e.code === "email_not_confirmed" ? "Falta confirmar el correo: abre el enlace que te enviamos y vuelve a intentarlo."
        : e.code === "invalid_credentials" ? "Correo o contraseña incorrectos."
        : e.code === "user_already_exists" ? "Ese correo ya tiene cuenta: entra con tu contraseña."
        : e.status === 429 ? "Demasiados intentos; espera unos minutos." : `No se pudo: ${e.message}`;
    }
  };
  for (const f of [input, pass]) f.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  const swap = el("button", "link", login.step === "signup" ? "Ya tengo cuenta: entrar" : "No tengo cuenta: crear una");
  swap.type = "button"; swap.addEventListener("click", () => { login.email = input.value.trim(); login.step = login.step === "signup" ? "signin" : "signup"; renderAccount(); });
  // Google needs a real browser tab (Google refuses sign-in inside app webviews), so only on the web.
  const google = tauri ? [] : [btn("Entrar con Google", () => { location.href = cloud.googleUrl(location.origin + location.pathname); }), el("p", "small", "o con tu correo:")];
  box.replaceChildren(el("p", "mgroup", login.step === "signup" ? "CREAR CUENTA" : "CUENTA"),
    el("p", "", "Con una cuenta, tu progreso se guarda en la nube y se sincroniza entre tus dispositivos. Es opcional: sin cuenta todo sigue funcionando en este dispositivo."),
    ...google, input, pass, btn(login.step === "signup" ? "Crear cuenta" : "Entrar", go), swap, msg);
  if (screen === "progress" && tab === "cuenta") input.focus({ preventScroll: true });
}

// Merge this device with the cloud: pull, combine card by card, apply what is new here, push the result.
let syncing = null;
function sync(loud = false) {
  if (!cloud.user() || !ready) return Promise.resolve();
  return (syncing ??= (async () => {
    try {
      const levels = LEVELS.map(l => l.id);
      const remote = await cloud.pullProgress();
      const local = readBackup(backupData(), levels);
      const merged = mergeProgress(local, remote ? readBackup(remote.data, levels) : null);
      if (changed(local, merged)) await applyBackup(merged);
      await cloud.pushProgress(JSON.parse(backupJson()));
      const rp = await cloud.pullProfile();
      if (rp && (!profile.updatedAt || Date.parse(rp.updated_at) > Date.parse(profile.updatedAt))) {
        profile = { name: rp.display_name ?? "", goal: rp.daily_goal, target: rp.target_level, targetDate: rp.target_date, updatedAt: rp.updated_at };
        store.setSync("kp-profile", profile);
      } else if (profile.updatedAt) await cloud.pushProfile(profile);
      syncState = { ok: true, at: Date.now(), msg: "" };
    } catch (e) {
      syncState = { ok: false, at: syncState.at, msg: navigator.onLine ? e.message : "sin conexión" };
      if (loud) $("msg").textContent = `No se pudo sincronizar: ${syncState.msg}`;
    } finally {
      syncing = null;
      if (screen === "progress") renderProgress();
    }
  })());
}

// ---------- mock exam ----------
let exam = null; // { qs, answers, i, left, paused, timer, from }
let exams = []; // past results, newest last
const deckOf = id => DECKS.find(d => d.id === id);

// Mock exams per level: N4 and N3 have no reading passages yet, so they are 20 questions with the clock scaled down.
const EXAM_DECKS = { n5: ["vocab", "gram5", READING_N5], n4: ["vocab4", "gram4", []], n3: ["vocab3", "gram3", []] };
const examMinutes = n => Math.round((EXAM_SECONDS * n) / 30 / 60);
function startExam(lv = "n5") {
  if (screen !== "pause" && screen !== "start") return;
  const [v, g, r] = EXAM_DECKS[lv];
  const qs = buildExam(deckOf(v).items, deckOf(g).items, r);
  exam = { lv, qs, answers: [], i: 0, left: examMinutes(qs.length) * 60, paused: false, from: screen };
  showExam(`SIMULACRO ${levelName(lv).toUpperCase()}`);
  exam.timer = setInterval(() => {
    if (exam.paused) return;
    exam.left--;
    renderClock();
    if (exam.left <= 0) finishExam();
  }, 1000);
  renderClock(); renderExamQ();
}

function showExam(title) {
  screen = "exam";
  $("overlay").hidden = true; $("exam").hidden = false;
  $("ebody").hidden = false; $("eresult").hidden = true; $("epause").hidden = true;
  $("etitle").textContent = title; $("etimer").hidden = !!exam.placement || exam.challenge === "survival" || exam.challenge === "daily";
  $("eresulttitle").textContent = exam.placement ? "Resultado de la prueba de nivel" : exam.challenge === "daily" ? "Resultado del reto del día" : exam.challenge ? "Resultado del reto" : "Resultado del simulacro";
  $("epausetxt").textContent = exam.placement || exam.challenge === "survival" || exam.challenge === "daily" ? "El reto está en pausa." : "El reloj está detenido.";
}

// ---------- placement test (same screen as the mock exam, no clock) ----------
const levelName = id => LEVELS.find(l => l.id === id)?.name ?? "";
const placementQs = lv => levelQuestions(DECKS, LEVELS[lv].id)
  .map(q => ({ ...q, section: q.kind === "grammar" ? "gram" : "vocab", ask: q.kind === "kana" ? "¿Cómo se lee?" : undefined }));

function startPlacement() {
  if (screen !== "pause" && screen !== "start") return;
  exam = { placement: true, lv: 0, rights: [], qs: placementQs(0), answers: [], i: 0, paused: false, from: screen };
  showExam("PRUEBA DE NIVEL");
  renderExamQ();
}

function nextPlacementLevel() {
  exam.rights.push(exam.qs.filter((q, i) => exam.answers[i] === q.answer).length);
  const lv = startLevel(LEVELS, exam.rights);
  if (!lv) { exam.lv++; exam.qs = placementQs(exam.lv); exam.answers = []; exam.i = 0; renderExamQ(); return; }
  prefs.level = lv; savePrefs();
  $("ebody").hidden = true; $("eresult").hidden = false;
  $("esec").textContent = "Resultado";
  $("escores").replaceChildren(...exam.rights.map((r, i) => {
    const d = el("div", "escore");
    d.append(el("b", "", `${r}/${PER_LEVEL}`), el("span", "", LEVELS[i].name));
    return d;
  }));
  $("epass").textContent = `Empiezas en ${levelName(lv)}`;
  $("epass").className = "epass ok";
  $("emissed").replaceChildren(el("p", "note", lv === "kana"
    ? "Las cartas nuevas empiezan por hiragana y katakana."
    : `Las cartas nuevas de tu repaso empiezan en ${levelName(lv)}. Los niveles anteriores siguen en Práctica.`));
  $("eback").focus({ preventScroll: true });
}

function renderClock() {
  $("etimer").textContent = clock(Math.max(0, exam.left));
  $("etimer").classList.toggle("low", exam.left < (exam.challenge ? 10 : 60));
}

function renderExamQ() {
  const q = exam.qs[exam.i];
  const n = SECTIONS.findIndex(s => s.id === q.section);
  $("esec").textContent = exam.challenge === "daily" ? `Pregunta ${exam.i + 1} de ${exam.qs.length} · ${exam.score} ${exam.score === 1 ? "acierto" : "aciertos"}`
    : exam.challenge ? `Aciertos: ${exam.score}` + (exam.challenge === "survival" ? " · un fallo y se acaba" : "")
    : exam.placement ? `${levelName(LEVELS[exam.lv].id)} · pregunta ${exam.i + 1} de ${exam.qs.length}`
    : `${n + 1} · ${SECTIONS[n].name} · pregunta ${exam.i + 1} de ${exam.qs.length}`;
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
    $("ehint").textContent = q.section === "gram" ? `Completa: ${q.hint}` : q.ask ?? "¿Qué significa?";
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
  // The Reto del día marks each answer right or wrong, like a study round; the other retos have no fixed length.
  const pip = i => exam.challenge === "daily" && i < exam.i ? (exam.results[i] ? "hit" : "miss") : i < exam.i ? "done" : i === exam.i ? (exam.challenge === "daily" ? "done" : "now") : "";
  $("epips").replaceChildren(...(exam.challenge && exam.challenge !== "daily" ? [] : exam.qs.map((_, i) => el("i", pip(i)))));
}

function examAnswer(k) {
  if (!exam || exam.paused || exam.locked || !$("eresult").hidden) return;
  if (exam.challenge) return challengeAnswer(k);
  const q = exam.qs[exam.i];
  exam.answers[exam.i] = q.opts[KEYS.indexOf(k)];
  exam.locked = true;
  $("eopts").querySelector(`[data-k="${k}"]`).classList.add("chosen");
  // The student may close the exam (or time may run out) before this fires; then it must do nothing.
  const s = exam;
  setTimeout(() => {
    if (exam !== s || !$("eresult").hidden) return;
    exam.locked = false;
    exam.i++;
    if (exam.i < exam.qs.length) renderExamQ(); else if (exam.placement) nextPlacementLevel(); else finishExam();
  }, 300);
}

function setExamPaused(p) {
  if (!exam || !$("eresult").hidden) return;
  exam.paused = p;
  $("epause").hidden = !p;
  $("ebody").hidden = p; // the clock stops, so the question can't stay visible to think about
}

function finishExam() {
  setTimeout(announceAchievements); // after this result is saved
  if (!exam || !$("eresult").hidden) return; // already finished: never save the same exam twice
  clearInterval(exam.timer);
  const r = scoreExam(exam.qs, exam.answers);
  exams = [...exams, { d: day.d, lv: exam.lv, right: r.right, total: r.total, pass: r.pass, per: Object.fromEntries(Object.entries(r.per).map(([k, v]) => [k, [v.right, v.total]])) }].slice(-20);
  store.set("kp-exams", exams);
  $("ebody").hidden = true; $("eresult").hidden = false; $("epause").hidden = true;
  $("esec").textContent = "Resultado";
  $("escores").replaceChildren(...SECTIONS.filter(s => r.per[s.id].total).map(s => {
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

// ---------- Retos rápidos (same screen as the mock exam, with feedback after each answer) ----------
function startChallenge(id) {
  if (screen !== "pause" && screen !== "start") return;
  // Cards already seen, without grammar (long sentences don't fit a fast round); kana until there are enough.
  let pool = seenEntries().filter(e => e.deck.kind !== "grammar");
  if (pool.length < MIN_POOL) pool = [...entriesOf("hira"), ...entriesOf("kata")];
  exam = { challenge: id, pool, qs: [challengeQuestion(pool)], answers: [], i: 0, score: 0, missed: [], left: CHALLENGES[id].seconds ?? 0, paused: false, from: screen };
  showExam(CHALLENGES[id].name.toUpperCase());
  if (id === "time") {
    exam.timer = setInterval(() => {
      if (exam.paused) return;
      exam.left--; renderClock();
      if (exam.left <= 0) finishChallenge();
    }, 1000);
    renderClock();
  }
  renderExamQ();
}
// Reto del día: 10 fixed questions from the decks of the student's level (kana before any level).
const dailyPool = () => ENTRIES.filter(e => e.deck.level === (prefs.level ?? "kana") && e.deck.kind !== "grammar");
function startDaily() {
  if (screen !== "pause" && screen !== "start") return;
  exam = { challenge: "daily", qs: dailyQuestions(dailyPool(), day.d), results: [], practice: daily[day.d] !== undefined,
    answers: [], i: 0, score: 0, missed: [], left: 0, paused: false, from: screen };
  showExam("RETO DEL DÍA");
  renderExamQ();
}
function dailyRow() {
  const done = daily[day.d], n = dailyStreak();
  return { group: "Hoy", icon: "bolt", label: "Reto del día", count: done === undefined ? "" : `${done}/${DAILY_QUESTIONS}`, action: startDaily,
    sub: done === undefined ? `Nuevo · ${DAILY_QUESTIONS} preguntas, las mismas todo el día` : `Hecho hoy · racha ${n} ${n === 1 ? "día" : "días"} · repetir es práctica` };
}
function challengeAnswer(k) {
  const q = exam.qs[exam.i], ok = q.opts[KEYS.indexOf(k)] === q.answer;
  exam.locked = true;
  if (ok) exam.score++; else { exam.missed.push(q); pad.rumble(); }
  if (prefs.sfx) (ok ? sfx.right : sfx.wrong)();
  exam.results?.push(ok);
  // Real practice, so it counts toward today's goal; the FSRS calendar is left alone.
  day.n++; countAnswer(); store.setSync("kp-day", day); renderTop();
  for (const b of $("eopts").children) {
    const v = q.opts[KEYS.indexOf(b.dataset.k)];
    b.classList.add(v === q.answer ? "right" : b.dataset.k === k ? "wrong" : "dim");
  }
  $("eprompt").className = "prompt " + (ok ? "ok" : "bad");
  if (exam.challenge !== "daily") $("esec").textContent = `Aciertos: ${exam.score}` + (exam.challenge === "survival" ? " · un fallo y se acaba" : "");
  const s = exam;
  // A miss stays a little longer so the right answer can be read.
  setTimeout(() => {
    if (exam !== s || !$("eresult").hidden) return;
    if (exam.challenge === "daily") exam.i++;
    if (exam.challenge === "daily" ? exam.i >= exam.qs.length : runOver(exam.challenge, ok, exam.challenge === "time" ? exam.left : Infinity)) return finishChallenge();
    exam.locked = false;
    if (exam.challenge !== "daily") exam.qs[exam.i] = challengeQuestion(exam.pool, Math.random, q.item);
    $("eprompt").className = "prompt";
    renderExamQ();
  }, ok ? 250 : 900);
}
const scoreBox = (n, label, cls = "escore") => { const b = el("div", cls); b.append(el("b", "", n), el("span", "", label)); return b; };
// Days in a row with the Reto del día done, ending today (or yesterday).
const dailyStreak = () => streakDays(Object.fromEntries(Object.keys(daily).map(d => [d, { answers: 1 }])), day.d);
function finishChallenge() {
  setTimeout(announceAchievements); // after this result is saved
  if (!exam || !$("eresult").hidden) return;
  clearInterval(exam.timer);
  $("ebody").hidden = true; $("eresult").hidden = false; $("epause").hidden = true;
  $("eprompt").className = "prompt";
  $("esec").textContent = "Resultado";
  if (exam.challenge === "daily") {
    // Only the first run of the day counts; repeating it is practice.
    if (!exam.practice) { daily = { ...daily, [day.d]: exam.score }; store.setSync("kp-daily", daily); }
    $("epips").replaceChildren(...exam.results.map(ok => el("i", ok ? "hit" : "miss")));
    $("escores").replaceChildren(scoreBox(`${exam.score}/${exam.qs.length}`, "aciertos"), scoreBox(String(dailyStreak()), dailyStreak() === 1 ? "día seguido" : "días seguidos", "escore best"));
    $("epass").textContent = exam.practice ? "Práctica: no cambia tu marca" : "¡Reto del día hecho!";
    $("epass").className = "epass " + (exam.practice ? "" : "ok");
  } else {
    const r = recordRun(records, exam.challenge, exam.score);
    records = r.records; store.setSync("kp-records", records);
    $("escores").replaceChildren(scoreBox(String(exam.score), exam.score === 1 ? "acierto" : "aciertos"), scoreBox(r.best ? String(r.best) : "—", "récord", "escore best"));
    if (r.isNew && prefs.sfx) sfx.win();
    $("epass").textContent = r.isNew ? "¡Nuevo récord!" : exam.challenge === "survival" ? "Se acabó al primer fallo" : "Se acabó el tiempo";
    $("epass").className = "epass " + (r.isNew ? "ok" : "");
  }
  const ul = el("ul", "missed");
  ul.append(...exam.missed.map(q => { const li = el("li"), inner = el("span"), jp = el("span", "jp", q.prompt); jp.lang = "ja"; inner.append(jp, q.answer); li.append(inner); return li; }));
  const box = el("div", "emcenter"); box.append(el("p", "emsection", "Para repasar"), ul);
  const tomorrow = exam.challenge === "daily" ? [el("p", "note emcenter", "Mañana hay preguntas nuevas.")] : [];
  $("emissed").replaceChildren(...tomorrow, ...(exam.missed.length ? [box] : []));
  $("eback").focus({ preventScroll: true });
}

function closeExam() {
  clearInterval(exam?.timer);
  screen = exam?.from ?? "start"; exam = null;
  $("exam").hidden = true; $("overlay").hidden = false;
  renderMenu();
}
$("eback").addEventListener("click", closeExam);
$("equit").addEventListener("click", closeExam);

// ---------- listening (§9.2) ----------
const allVoices = () => [...BUILT_IN, ...(window.speechSynthesis?.getVoices() ?? [])];
const listenVoices = () => activeVoices(allVoices(), prefs.listenVoices ?? []);
let listen = null; // { qs, i, results, voice, locked }

function startListening() {
  if (!listenVoices().length) { openVoices(); return; }
  const lv = prefs.level === "n4" || prefs.level === "n3" ? prefs.level : "n5";
  const of = kind => DECKS.filter(d => d.level === lv && d.kind === kind).flatMap(d => d.items);
  listen = { qs: buildListening(of("vocab"), of("grammar"), 10), i: 0, results: [], from: listen?.from ?? screen };
  screen = "listen";
  $("overlay").hidden = true; $("listen").hidden = false;
  $("lbody").hidden = false; $("lresult").hidden = true;
  renderListenQ();
}

function sayWith(text, voice, slow = false) {
  if (!voice) return;
  const v = voiceVariation(listenVoices().length);
  say(text, voice, { pitch: v.pitch, rate: slow ? 0.7 : v.rate, wave: true });
}

function renderListenQ() {
  const q = listen.qs[listen.i], voices = listenVoices();
  listen.voice = pickVoice(voices);
  listen.locked = false;
  $("lsec").textContent = `Pregunta ${listen.i + 1} de ${listen.qs.length}`;
  $("lq").innerHTML = SPEAKER;
  $("lchip").textContent = voices.length > 1 ? `VOZ ${voices.indexOf(listen.voice) + 1} DE ${voices.length}` : "VOZ 1 DE 1 · VARIADA";
  $("lreading").textContent = ""; $("lverdict").textContent = ""; $("lverdict").className = "verdict"; $("lnote").textContent = "";
  $("lprompt").className = "prompt";
  $("lopts").replaceChildren(...KEYS.map((k, i) => {
    const b = el("button", "bar"); b.type = "button"; b.dataset.k = k;
    const badge = el("span", "badge", k.toUpperCase()); badge.dataset.k = k;
    b.append(badge, el("span", "label", q.opts[i]));
    b.addEventListener("click", () => listenAnswer(k));
    return b;
  }));
  $("lpips").replaceChildren(...listen.qs.map((_, i) => el("i", listen.results[i] === undefined ? "" : listen.results[i] ? "hit" : "miss")));
  sayWith(q.say, listen.voice);
}

function listenAnswer(k) {
  if (!listen || listen.locked) return;
  listen.locked = true;
  const q = listen.qs[listen.i], chosen = q.opts[KEYS.indexOf(k)], ok = chosen === q.answer;
  listen.results.push(ok);
  for (const b of $("lopts").children) {
    const v = q.opts[KEYS.indexOf(b.dataset.k)];
    b.classList.add(v === q.answer ? "right" : b.dataset.k === k ? "wrong" : "dim");
  }
  $("lprompt").className = "prompt " + (ok ? "ok" : "bad");
  $("lq").className = "glyph" + (q.shown.length > 3 ? " sentence" : q.shown.length === 2 ? " len2" : q.shown.length > 2 ? " len3" : "");
  $("lq").textContent = q.shown; $("lq").lang = "ja";
  $("lchip").textContent = `VOZ: ${(listen.voice?.name ?? "").replace(/^Microsoft |\s*-.*$/g, "").toUpperCase()}`;
  $("lverdict").textContent = ok ? "¡CORRECTO!" : `ERA: ${q.answer}`;
  $("lverdict").className = "verdict " + (ok ? "ok" : "bad");
  if (!ok) { $("lnote").textContent = `Voz: ${listen.voice?.name ?? "—"}`; pad.rumble(); }
  bumpKind("listening", ok);
  countAnswer();
  const s = listen;
  setTimeout(() => {
    if (listen !== s) return; // closed or restarted meanwhile
    listen.i++;
    if (listen.i < listen.qs.length) renderListenQ(); else finishListening();
  }, ok ? 1400 : 2600);
}

function finishListening() {
  const hits = listen.results.filter(Boolean).length;
  $("lbody").hidden = true; $("lresult").hidden = false;
  $("lsec").textContent = "Resultado";
  $("lscore").textContent = `${hits} / ${listen.results.length}`;
  $("lagain").focus({ preventScroll: true });
}
function closeListening() {
  stopVoice(); screen = listen?.from ?? "start"; listen = null; $("listen").hidden = true; $("overlay").hidden = false;
  menu.sub = null; renderMenu();
}
$("lagain").addEventListener("click", startListening);
$("lback").addEventListener("click", closeListening);
$("lrepeat").addEventListener("click", () => listen && sayWith(listen.qs[listen.i]?.say ?? "", listen.voice));
$("lslow").addEventListener("click", () => listen && sayWith(listen.qs[listen.i]?.say ?? "", listen.voice, true));

// ---------- drawing practice ----------
// Kana and kanji already seen in the review; before that, the start level's own characters.
let draw = null; // { pool, i, strokes, graded }
const drawable = e => e.deck.kind === "kana" || e.deck.kind === "kanji";
function drawPool() {
  const seen = ENTRIES.filter(e => drawable(e) && cards[e.key]);
  return seen.length >= 5 ? seen : ENTRIES.filter(e => drawable(e) && e.deck.level === (prefs.level ?? "kana"));
}
function startDraw() {
  draw = { pool: shuffle(drawPool()).slice(0, 10), i: 0, from: screen };
  screen = "draw";
  $("overlay").hidden = true; $("draw").hidden = false;
  renderDraw();
}
function renderDraw() {
  const { item, deck } = draw.pool[draw.i];
  Object.assign(draw, { strokes: [], graded: null });
  $("dsec").textContent = `${deck.name} · ${draw.i + 1} de ${draw.pool.length}`;
  $("dmeaning").textContent = item.a;
  $("dreading").textContent = deck.kind === "kana" ? `en ${deck.name.toLowerCase()}` : item.r ?? "";
  $("dverdict").textContent = ""; $("dverdict").className = "verdict"; $("dnote").textContent = "";
  $("dchecktxt").textContent = "Revisar";
  $("dmodel").replaceChildren(); $("dmodel").className = "dmodel"; $("dshow").setAttribute("aria-pressed", "false");
  paintDrawing();
}
function paintDrawing() {
  const c = $("dcanvas"), g = c.getContext("2d"), k = c.width / 109;
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = getComputedStyle(c).getPropertyValue("--hi").trim() || "#ffe600";
  g.lineWidth = 5 * k; g.lineCap = g.lineJoin = "round";
  for (const s of draw.strokes) {
    g.beginPath();
    s.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    if (s.length === 1) g.lineTo(s[0][0] * k + 0.1, s[0][1] * k);
    g.stroke();
  }
}
async function showModel(colors) {
  const svg = strokeSvg(await strokePaths(draw.pool[draw.i].item.q));
  if (colors) [...svg.children].forEach((p, i) => p.classList.add(colors[i]));
  $("dmodel").replaceChildren(svg);
}
async function checkDrawing() {
  if (!draw) return;
  if (draw.graded) { draw.i++; return draw.i < draw.pool.length ? renderDraw() : closeDraw(); }
  if (!draw.strokes.length) { $("dnote").textContent = "Dibuja primero."; return; }
  if (draw.checking) return; // A pressed twice: grade once
  const s = draw;
  s.checking = true;
  const paths = await strokePaths(s.pool[s.i].item.q);
  s.checking = false;
  if (draw !== s || s.graded) return;
  if (!paths.length) { $("dnote").textContent = "No hay modelo de trazos para este carácter."; return; }
  const r = gradeDrawing(draw.strokes, paths.map(d => pathPoints(d)));
  draw.graded = r;
  await showModel(r.strokes.map(s => (s.score >= 0.7 ? "ok" : s.score >= 0.4 ? "meh" : "bad")));
  $("dmodel").classList.add("graded");
  $("dverdict").textContent = `${r.score} · ${verdict(r.score).toUpperCase()}`;
  $("dverdict").className = "verdict " + (r.score >= 65 ? "ok" : "bad");
  const notes = [];
  if (r.count[0] !== r.count[1]) notes.push(`Hiciste ${r.count[0]} trazo${r.count[0] === 1 ? "" : "s"}; lleva ${r.count[1]}.`);
  const rev = r.strokes.map((s, i) => (s.reversed ? i + 1 : 0)).filter(Boolean);
  if (rev.length) notes.push(`Al revés: trazo ${rev.join(", ")}.`);
  notes.push("Verde: bien · amarillo: casi · rojo: revisa forma u orden.");
  $("dnote").textContent = notes.join(" ");
  $("dchecktxt").textContent = draw.i + 1 < draw.pool.length ? "Siguiente" : "Terminar";
  if (r.score < 40) pad.rumble();
  const dk = (kinds.draw ??= [0, 0]); dk[0] += r.score; dk[1]++; store.setSync("kp-kinds", kinds);
  countAnswer();
}
function closeDraw() {
  screen = draw?.from ?? "start"; draw = null;
  $("draw").hidden = true; $("overlay").hidden = false;
  menu.sub = null; renderMenu();
}
const drawAction = {
  undo: () => { if (draw && !draw.graded) { draw.strokes.pop(); paintDrawing(); } },
  clear: () => { if (draw && !draw.graded) { draw.strokes = []; paintDrawing(); } },
  show: () => {
    if (!draw || draw.graded) return;
    const on = !$("dmodel").children.length;
    if (on) showModel(); else $("dmodel").replaceChildren();
    $("dshow").setAttribute("aria-pressed", on);
  },
};
{
  const c = $("dcanvas");
  const at = e => { const b = c.getBoundingClientRect(); return [((e.clientX - b.left) * 109) / b.width, ((e.clientY - b.top) * 109) / b.height]; };
  let finger = null; // the pointer drawing the current stroke
  c.addEventListener("pointerdown", e => {
    if (!draw || draw.graded || finger !== null) return;
    finger = e.pointerId;
    c.setPointerCapture(e.pointerId); draw.strokes.push([at(e)]); paintDrawing();
  });
  for (const ev of ["pointerup", "pointercancel"]) c.addEventListener(ev, e => { if (e.pointerId === finger) finger = null; });
  c.addEventListener("pointermove", e => {
    if (!draw || draw.graded || e.pointerId !== finger) return;
    draw.strokes.at(-1).push(at(e)); paintDrawing();
  });
}
$("dundo").addEventListener("click", drawAction.undo);
$("dclear").addEventListener("click", drawAction.clear);
$("dshow").addEventListener("click", drawAction.show);
$("dcheck").addEventListener("click", checkDrawing);

// ---------- stories (§9.3) ----------
const SCRIPTS = ["hira", "kata", "kanji"];
let storyTab = "hira", storySel = 0, story = null; // { st, lines, flat, w, qi, results, missed }
let storyScores = store.getSync("kp-stories", {});
const storiesOf = tab => STORIES_N5.filter(s => s.script === tab);
const newStories = () => STORIES_N5.filter(s => !storyScores[s.id]).length;

let storiesFrom = "start";
function openStories() {
  storiesFrom = screen;
  screen = "stories";
  $("overlay").hidden = true; $("stories").hidden = false;
  showStoryPart("list"); renderStoryList();
}
function showStoryPart(part) {
  $("slist").hidden = part !== "list"; $("stabs").hidden = part !== "list";
  $("sreader").hidden = part !== "read"; $("sfuri").hidden = part !== "read";
  $("squiz").hidden = part !== "quiz"; $("sresult").hidden = part !== "result";
  $("spreview").hidden = part !== "list";
  if (part === "list") { $("stitle").textContent = "CUENTOS"; $("stitle").lang = "es"; }
}
function renderStoryList() {
  for (const b of $("stabs").querySelectorAll(".tab")) b.setAttribute("aria-selected", b.dataset.tab === storyTab);
  const list = storiesOf(storyTab);
  storySel = Math.min(storySel, list.length - 1);
  $("slist").replaceChildren(...list.map((st, i) => {
    const b = el("button", "menu-item story-item" + (i === storySel ? " sel" : "")); b.type = "button";
    b.insertAdjacentHTML("beforeend", icon("book"));
    const label = el("span", "mlabel");
    const jp = el("span", "jp", parseWord(st.title).plain); jp.lang = "ja";
    label.append(jp, el("span", "msub", st.questions.length + " preguntas"));
    const sc = storyScores[st.id];
    b.append(label, el("span", "story-state" + (sc ? "" : " new"), sc ? `${sc.right}/${sc.total}` : "NUEVO"));
    b.addEventListener("click", () => { storySel = i; openStory(); });
    return b;
  }));
  $("slist").children[storySel]?.focus({ preventScroll: true });
  // Preview of the selected story (wide screens): title, its first lines and the last score.
  const st = list[storySel], sc = storyScores[st.id];
  const title = el("p", "sptitle", parseWord(st.title).plain); title.lang = "ja";
  const lines = el("p", "splines", parseStory(st.text).slice(0, 3).map(ws => ws.map(w => w.plain).join(" ")).join("\n") + " …"); lines.lang = "ja";
  const meta = el("p", "spmeta"); meta.append(el("b", "", String(st.questions.length)), " preguntas · ", sc ? el("b", "", `${sc.right}/${sc.total}`) : el("b", "", "nuevo"), sc ? " la última vez" : "");
  $("spreview").replaceChildren(title, lines, meta, el("p", "mfoot pad-only", "A leer · LB/RB escritura"));
}
function moveStoryList(d) { const n = storiesOf(storyTab).length; storySel = (storySel + d + n) % n; renderStoryList(); }
function storyTabBy(d) { storyTab = SCRIPTS[(SCRIPTS.indexOf(storyTab) + d + 3) % 3]; storySel = 0; renderStoryList(); }

function openStory() {
  const st = storiesOf(storyTab)[storySel];
  const lines = parseStory(st.text);
  story = { st, lines, flat: lines.flatMap((ws, li) => ws.map((w, wi) => ({ w, li, wi }))), w: 0, qi: 0, results: [], missed: [] };
  $("stitle").textContent = parseWord(st.title).plain; $("stitle").lang = "ja";
  $("sfuri").disabled = st.script !== "kanji";
  $("sfuri").setAttribute("aria-pressed", st.script === "kanji" && prefs.furigana !== false);
  showStoryPart("read");
  $("sfuri").hidden = st.script !== "kanji"; // only kanji stories have furigana to toggle
  renderStoryText(); selectWord(0);
}
function renderStoryText() {
  $("stext").classList.toggle("nofuri", prefs.furigana === false);
  $("stext").replaceChildren(...story.lines.flatMap((ws, li) => {
    const parts = ws.flatMap((w, wi) => {
      const b = el("button", "word"); b.type = "button"; b.dataset.i = story.flat.findIndex(f => f.li === li && f.wi === wi);
      for (const s of w.segs) {
        if (s.base) { const r = document.createElement("ruby"); r.append(s.base, el("rt", "", s.rt)); b.append(r); }
        else b.append(s.text);
      }
      const v = lookupWord(w, deckOf("vocab").items);
      if (v && cards["vocab:" + v.q]) b.classList.add("saved");
      b.addEventListener("click", () => selectWord(Number(b.dataset.i)));
      return [b, " "];
    });
    return li < story.lines.length - 1 ? [...parts, document.createElement("br")] : parts;
  }));
}
function selectWord(i) {
  story.w = Math.max(0, Math.min(story.flat.length - 1, i));
  const btns = $("stext").querySelectorAll(".word");
  btns.forEach(b => b.classList.toggle("sel", Number(b.dataset.i) === story.w));
  btns[story.w]?.scrollIntoView({ block: "nearest" });
  const { w } = story.flat[story.w];
  const v = lookupWord(w, deckOf("vocab").items);
  const panel = [el("b", "", w.plain.replace(/[、。「」！？]/g, ""))];
  panel.at(-1).lang = "ja";
  if (v) {
    panel.push(el("small", "", v.q === v.r ? v.r : `${v.q} · ${v.r}`), el("span", "", v.a));
    const saved = !!cards["vocab:" + v.q];
    const add = el("button", "mode"); add.type = "button";
    const ab = el("span", "badge", "A"); ab.dataset.k = "a";
    add.append(ab, saved ? "✓ En Repaso" : "Guardar en Repaso"); add.disabled = saved;
    add.addEventListener("click", saveWord);
    panel.push(add);
  } else panel.push(el("small", "", "Esta palabra aún no está en el vocabulario de la app."));
  const say = el("button", "mode"); say.type = "button";
  const xb = el("span", "badge", "X"); xb.dataset.k = "x"; say.append(xb, "Escuchar");
  say.addEventListener("click", () => speak(w.reading));
  panel.push(say);
  $("sword").replaceChildren(...panel);
}
function moveLine(d) {
  const cur = story.flat[story.w], li = Math.max(0, Math.min(story.lines.length - 1, cur.li + d));
  const wi = Math.min(cur.wi, story.lines[li].length - 1);
  selectWord(story.flat.findIndex(f => f.li === li && f.wi === wi));
}
// Mining: the word becomes a card in Repaso de hoy right away (due within a minute).
function saveWord() {
  const v = lookupWord(story.flat[story.w].w, deckOf("vocab").items);
  if (!v || cards["vocab:" + v.q]) return;
  cards["vocab:" + v.q] = grade(undefined, false, 0);
  saveCards();
  renderStoryText(); selectWord(story.w);
}
function sayLine() { speak(story.lines[story.flat[story.w].li].map(w => w.reading).join("")); }

function startStoryQuiz() { story.qi = 0; showStoryPart("quiz"); renderStoryQ(); }
function renderStoryQ() {
  const q = story.st.questions[story.qi];
  story.opts = shuffle([q.a, ...q.o]); story.locked = false;
  $("sq").textContent = q.q; $("shint").textContent = `Pregunta ${story.qi + 1} de ${story.st.questions.length}`;
  $("sverdict").textContent = ""; $("sverdict").className = "verdict";
  $("squiz").querySelector(".prompt").className = "prompt";
  $("sopts").replaceChildren(...KEYS.map((k, i) => {
    const b = el("button", "bar"); b.type = "button"; b.dataset.k = k;
    const badge = el("span", "badge", k.toUpperCase()); badge.dataset.k = k;
    b.append(badge, el("span", "label", story.opts[i]));
    b.addEventListener("click", () => storyAnswer(k));
    return b;
  }));
  $("spips").replaceChildren(...story.st.questions.map((_, i) => el("i", story.results[i] === undefined ? "" : story.results[i] ? "hit" : "miss")));
}
function storyAnswer(k) {
  if (!story || story.locked) return;
  story.locked = true;
  const q = story.st.questions[story.qi], chosen = story.opts[KEYS.indexOf(k)], ok = chosen === q.a;
  story.results.push(ok); if (!ok) story.missed.push(q);
  bumpKind("reading", ok);
  for (const b of $("sopts").children) {
    const v = story.opts[KEYS.indexOf(b.dataset.k)];
    b.classList.add(v === q.a ? "right" : b.dataset.k === k ? "wrong" : "dim");
  }
  $("squiz").querySelector(".prompt").className = "prompt " + (ok ? "ok" : "bad");
  $("sverdict").textContent = ok ? "¡CORRECTO!" : `ERA: ${q.a}`;
  $("sverdict").className = "verdict " + (ok ? "ok" : "bad");
  if (!ok) pad.rumble();
  countAnswer();
  const s = story;
  setTimeout(() => {
    if (story !== s) return; // closed meanwhile
    story.qi++;
    if (story.qi < story.st.questions.length) renderStoryQ(); else finishStory();
  }, ok ? 1200 : 2400);
}
function finishStory() {
  setTimeout(announceAchievements); // after this result is saved
  const right = story.results.filter(Boolean).length, total = story.results.length;
  storyScores[story.st.id] = { right, total }; store.setSync("kp-stories", storyScores);
  showStoryPart("result");
  $("sscore").textContent = `${right} / ${total}`;
  $("smissed").replaceChildren(...story.missed.map(q => { const li = el("li"); li.append(el("span", "", `${q.q} → ${q.a}`)); return li; }));
  $("sagain").focus({ preventScroll: true });
}
function storyBack() {
  if (!$("slist").hidden) { closeStories(); return; }
  stopVoice(); story = null; showStoryPart("list"); renderStoryList();
}
function closeStories() {
  screen = storiesFrom; $("stories").hidden = true; $("overlay").hidden = false;
  menu.sub = null; renderMenu();
}
function toggleFurigana() {
  if (!story || story.st.script !== "kanji") return;
  prefs.furigana = prefs.furigana === false; savePrefs();
  $("sfuri").setAttribute("aria-pressed", prefs.furigana !== false);
  $("stext").classList.toggle("nofuri", prefs.furigana === false);
}
$("sagain").addEventListener("click", () => { storyBack(); });
$("sfuri").addEventListener("click", toggleFurigana);
$("sline").addEventListener("click", () => story && sayLine());
$("squizbtn").addEventListener("click", () => story && startStoryQuiz());
for (const b of $("stabs").querySelectorAll(".tab")) b.addEventListener("click", () => { storyTab = b.dataset.tab; storySel = 0; renderStoryList(); });

// ---------- back arrow and home (every screen) ----------
// Back does what B / Esc do on that screen; home goes to the main menu (from a round, the pause menu,
// so "Continuar" is still there; from a running exam, its pause, which has "Salir").
function goBack() {
  if (screen === "play" || screen === "summary") setPaused(true);
  else if (screen === "start" || screen === "pause") {
    // The arrow goes back a page: a sub-page, then Hoy, then (in the pause) the round itself.
    if (menu.sub) menuBack();
    else if (menu.cat !== 0) goHome();
    else if (screen === "pause") setPaused(false);
  }
  else if (screen === "exam") { if (!$("eresult").hidden || exam?.paused) closeExam(); else setExamPaused(true); }
  else if (screen === "listen") closeListening();
  else if (screen === "stories") storyBack();
  else if (screen === "progress") closeProgress();
  else if (screen === "draw") closeDraw();
}
function goHome() {
  if (screen === "play" || screen === "summary") setPaused(true);
  else if (screen === "exam" && $("eresult").hidden && !exam?.paused) return setExamPaused(true);
  else if (screen === "exam") closeExam();
  else if (screen === "listen") closeListening();
  else if (screen === "stories") closeStories();
  else if (screen === "progress") closeProgress();
  else if (screen === "draw") closeDraw();
  Object.assign(menu, { cat: 0, sel: 0, focus: "panel", sub: null }); $("credits").hidden = true;
  if (!$("overlay").hidden) renderMenu();
}
document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-nav]");
  if (b) (b.dataset.nav === "home" ? goHome : goBack)();
});

// ---------- input ----------
const ANSWER_BUTTONS = { 0: "a", 1: "b", 2: "x", 3: "y", 12: "y", 13: "a", 14: "x", 15: "b" };
const pad = createPad(i => {
  if (screen === "exam") {
    if (!$("eresult").hidden) { if (i === 0 || i === 1) closeExam(); return; }
    if (i === 9) return setExamPaused(!exam.paused);
    if (exam.paused) { if (i === 0) setExamPaused(false); else if (i === 1) closeExam(); return; }
    if (ANSWER_BUTTONS[i]) examAnswer(ANSWER_BUTTONS[i]);
    return; // LB/RB and the modes stay locked during the exam
  }
  if (screen === "listen") {
    if (!$("lresult").hidden) { if (i === 0) startListening(); else if (i === 1 || i === 9) closeListening(); return; }
    if (i === 8) return $("lrepeat").click();
    if (i === 7) return $("lslow").click();
    if (i === 9) return closeListening();
    if (ANSWER_BUTTONS[i]) listenAnswer(ANSWER_BUTTONS[i]);
    return;
  }
  if (screen === "stories") { storyInput(i); return; }
  if (screen === "draw") {
    if (i === 0) checkDrawing(); else if (i === 4) drawAction.clear(); else if (i === 2) drawAction.undo();
    else if (i === 3) drawAction.show(); else if (i === 1 || i === 9) closeDraw();
    return;
  }
  if (screen === "progress") {
    if (i === 4 || i === 14) setTab(TABS[TABS.indexOf(tab) - 1] ?? TABS.at(-1));
    else if (i === 5 || i === 15) setTab(TABS[TABS.indexOf(tab) + 1] ?? TABS[0]);
    else if (i === 12) scrollProgress(-1);
    else if (i === 13) scrollProgress(1);
    else if (i === 1 || i === 9) closeProgress();
    return;
  }
  if (screen === "start" || screen === "pause") {
    if (i === 12) moveMenu(-1);
    else if (i === 13) moveMenu(1);
    else if (i === 0) activateMenu();
    else if (i === 14) menuSide(-1);
    else if (i === 15) menuSide(1);
    else if (i === 2 && menu.sub) menuRows()[menu.sel]?.test?.(); // X: try a voice
    else if (i === 9 && screen === "pause") setPaused(false);
    else if (i === 1 || i === 9) menuBack();
    else if (i === 8) { toggle("voice"); renderMenu(); }
    return;
  }
  if (i === 4) return setDeck(prefs.deck - 1);
  if (i === 5) return setDeck(prefs.deck + 1);
  if (i === 8) return toggle("voice");
  if (screen === "summary") { if (i === 0) continueStudy(); else if (i === 2 && !$("morenew").hidden) moreNew(); else if (i === 1 || i === 9) setPaused(true); return; }
  if (i === 9) return setPaused(true);
  if (i === 6) return toggle("ear");
  if (i === 7) return toggle("reverse");
  if (ANSWER_BUTTONS[i]) answer(ANSWER_BUTTONS[i]);
}, () => screen === "start" || screen === "pause" || (screen === "stories" && ($("squiz").hidden)));

function storyInput(i) {
  if (!$("slist").hidden) {
    if (i === 12) moveStoryList(-1); else if (i === 13) moveStoryList(1);
    else if (i === 4) storyTabBy(-1); else if (i === 5) storyTabBy(1);
    else if (i === 0) openStory(); else if (i === 1 || i === 9) closeStories();
  } else if (!$("sreader").hidden) {
    if (i === 14) selectWord(story.w - 1); else if (i === 15) selectWord(story.w + 1);
    else if (i === 12) moveLine(-1); else if (i === 13) moveLine(1);
    else if (i === 0) saveWord(); else if (i === 2) speak(story.flat[story.w].w.reading);
    else if (i === 6) sayLine(); else if (i === 3) toggleFurigana();
    else if (i === 5) startStoryQuiz(); else if (i === 1 || i === 9) storyBack();
  } else if (!$("squiz").hidden) {
    if (ANSWER_BUTTONS[i]) storyAnswer(ANSWER_BUTTONS[i]); else if (i === 1 || i === 9) storyBack();
  } else if (i === 0 || i === 1 || i === 9) storyBack();
}

document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, select, textarea")) return;
  // A held key repeats; that may scroll a menu but must never answer cards on its own.
  const answering = !(screen === "start" || screen === "pause" || (screen === "stories" && $("squiz").hidden));
  if (e.repeat && answering) return;
  const arrows = { ArrowUp: "y", ArrowLeft: "x", ArrowRight: "b", ArrowDown: "a" };
  const key = e.key.toLowerCase();
  if (screen === "exam") {
    // preventDefault: otherwise the same Enter also "clicks" the button that just got focus.
    if (!$("eresult").hidden) { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeExam(); } return; }
    if (e.key === "Escape") return setExamPaused(!exam.paused);
    if (exam.paused) { if (e.key === "Enter") { e.preventDefault(); setExamPaused(false); } else if (key === "b") closeExam(); return; }
    if (arrows[e.key]) { e.preventDefault(); examAnswer(arrows[e.key]); }
    return;
  }
  if (screen === "listen") {
    if (!$("lresult").hidden) { if (e.key === "Enter") { e.preventDefault(); startListening(); } else if (e.key === "Escape") closeListening(); return; }
    if (e.key === "Escape") return closeListening();
    if (key === "r") return $("lrepeat").click();
    if (key === "l") return $("lslow").click();
    if (arrows[e.key]) { e.preventDefault(); listenAnswer(arrows[e.key]); }
    return;
  }
  if (screen === "draw") {
    if (e.key === "Enter") { e.preventDefault(); checkDrawing(); }
    else if (e.key === "Escape") closeDraw();
    else if (e.key === "Backspace") { e.preventDefault(); drawAction.undo(); }
    else if (key === "c") drawAction.clear();
    else if (key === "m") drawAction.show();
    return;
  }
  if (screen === "stories") {
    const reading = !$("sreader").hidden, quiz = !$("squiz").hidden;
    const map = reading
      ? { ArrowLeft: 14, ArrowRight: 15, ArrowUp: 12, ArrowDown: 13, Enter: 0, Escape: 1, x: 2, l: 6, y: 3, e: 5 }
      : quiz ? {} : { ArrowUp: 12, ArrowDown: 13, Enter: 0, Escape: 1, q: 4, e: 5 };
    if (quiz) { if (arrows[e.key]) { e.preventDefault(); storyAnswer(arrows[e.key]); } else if (e.key === "Escape") storyBack(); return; }
    const i = map[e.key] ?? map[key];
    if (i !== undefined) { e.preventDefault(); storyInput(i); }
    return;
  }
  if (screen === "progress") {
    if (key === "q" || e.key === "ArrowLeft") setTab(TABS[TABS.indexOf(tab) - 1] ?? TABS.at(-1));
    else if (key === "e" || e.key === "ArrowRight") setTab(TABS[TABS.indexOf(tab) + 1] ?? TABS[0]);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); scrollProgress(e.key === "ArrowUp" ? -1 : 1); }
    else if (e.key === "Escape" || key === "b") closeProgress();
    return;
  }
  if (screen === "start" || screen === "pause") {
    if (e.key === "ArrowUp") { e.preventDefault(); moveMenu(-1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveMenu(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); menuSide(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); menuSide(1); }
    else if (e.key === "Enter") { e.preventDefault(); activateMenu(); }
    else if (e.key === "Escape" && screen === "pause") setPaused(false);
    else if (e.key === "Escape" || key === "b" || e.key === "Backspace") menuBack();
    else if (key === "p") openProgress();
    else if (key === "x" && menu.sub) menuRows()[menu.sel]?.test?.();
    return;
  }
  if (arrows[e.key] && screen === "play") { e.preventDefault(); answer(arrows[e.key]); }
  else if (key === "q") setDeck(prefs.deck - 1);
  else if (key === "e") setDeck(prefs.deck + 1);
  else if (key === "s") toggle("voice");
  else if (key === "o") toggle("ear");
  else if (key === "i") toggle("reverse");
  else if (e.key === "Escape" && (screen === "play" || screen === "summary")) setPaused(true);
  else if (e.key === "Enter" && screen === "summary") { e.preventDefault(); continueStudy(); }
  else if (key === "n" && screen === "summary" && !$("morenew").hidden) moreNew();
});

$("again").addEventListener("click", continueStudy);
$("morenew").addEventListener("click", moreNew);
$("decktag").addEventListener("click", () => setDeck(prefs.deck + 1));
$("ear").addEventListener("click", () => toggle("ear"));
$("reverse").addEventListener("click", () => toggle("reverse"));

// ---------- progress backup ----------
const backupData = () => ({ app: "kana-pad", v: 5, stats, cards, day, prefs, history, exams, stories: storyScores, kinds,
  records, daily, achvSeen: [...achvSeen].sort() });
const backupJson = () => JSON.stringify(backupData(), null, 2);

// Desktop/Android builds save a weekly copy on disk by themselves; the web asks the student to export.
const tauri = window.__TAURI__?.core;
async function autoBackup() {
  if (!tauri || !backupDue(store.getSync("kp-lastbackup", null))) return;
  try {
    await tauri.invoke("save_backup", { name: `KanaPad-respaldo-${todayKey()}.json`, json: backupJson() });
    store.setSync("kp-lastbackup", new Date().toISOString());
  } catch {}
}
function renderBackupReminder() {
  const last = store.getSync("kp-lastexport", null);
  const show = !tauri && Object.keys(cards).length >= 20 && backupDue(last);
  $("backupmsg").hidden = !show;
  if (show) $("backupmsg").textContent = last
    ? `Hace ${daysSince(last)} días que no exportas tu progreso. Exportarlo te protege si se borran los datos del navegador.`
    : "Todavía no has exportado tu progreso. Exportarlo te protege si se borran los datos del navegador.";
}

function exportProgress() {
  const blob = new Blob([backupJson()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kana-pad-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("msg").textContent = "Progreso exportado.";
  store.setSync("kp-lastexport", new Date().toISOString());
  renderBackupReminder();
}
// Importing replaces the whole progress, so it waits for a confirmation in Ajustes and keeps
// the previous progress for "Deshacer la última importación".
let pendingImport = null; // { r, name }
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
$("import").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    pendingImport = { r: readBackup(JSON.parse(await file.text()), LEVELS.map(l => l.id)), name: file.name };
    $("msg").textContent = `«${file.name}» está listo. Confírmalo abajo: reemplaza tu progreso actual.`;
  } catch {
    pendingImport = null;
    $("msg").textContent = "Ese archivo no es una copia de Kana Pad. Exporta uno desde esta pantalla y vuelve a intentarlo.";
  }
  renderMenu();
});

async function applyBackup(r) {
  stats = r.stats; store.setSync("kp-stats", stats);
  if (r.history) { history = r.history; store.setSync("kp-hist", history); }
  if (r.exams) { exams = r.exams; store.set("kp-exams", exams); }
  if (r.stories) { storyScores = r.stories; store.setSync("kp-stories", storyScores); }
  if (r.kinds) { kinds = r.kinds; store.setSync("kp-kinds", kinds); }
  if (r.records) { records = r.records; store.setSync("kp-records", records); }
  if (r.daily) { daily = r.daily; store.setSync("kp-daily", daily); }
  if (r.achvSeen) { achvSeen = r.achvSeen; store.setSync("kp-achv-seen", achvSeen); }
  if (r.prefs) { Object.assign(prefs, r.prefs); if (!MODES[prefs.deck]) prefs.deck = 0; savePrefs(); }
  cards = r.cards;
  await store.set("kp-cards", cards);
  renderTop(); renderMenu();
}
async function confirmImport() {
  if (!pendingImport) return;
  const { r } = pendingImport;
  pendingImport = null;
  store.setSync("kp-preimport", backupJson());
  await applyBackup(r);
  $("msg").textContent = `Progreso importado: ${plural(Object.keys(stats).length, "carta practicada", "cartas practicadas")}, ${Object.keys(cards).length} en repaso.` +
    (r.skipped ? ` Se ${r.skipped === 1 ? "omitió" : "omitieron"} ${plural(r.skipped, "carta dañada", "cartas dañadas")}; ${r.skipped === 1 ? "volverá como nueva" : "volverán como nuevas"}.` : "");
}
async function undoImport() {
  try { await applyBackup(readBackup(JSON.parse(store.getSync("kp-preimport", "")), LEVELS.map(l => l.id))); }
  catch { $("msg").textContent = "No se pudo recuperar el progreso anterior."; return; }
  store.setSync("kp-preimport", null);
  $("msg").textContent = "Volviste al progreso de antes de importar.";
  renderMenu();
}

setInterval(() => {
  const s = pad.status();
  $("dot").classList.toggle("on", s.on);
  document.body.classList.toggle("pad", s.on);
  $("padtxt").textContent = s.text;
}, 500);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
function checkVoices() {
  jaVoice = allVoices().some(v => v.lang.startsWith("ja"));
  renderTop();
}
window.speechSynthesis?.addEventListener?.("voiceschanged", checkVoices);
checkVoices();
document.querySelector(".app").inert = true;
store.get("kp-exams", []).then(x => { exams = Array.isArray(x) ? x : []; });
store.get("kp-cards", {}).then(async c => {
  cards = sanitizeCards(c);
  ready = true; renderMenu();
  try { if (await cloud.takeRedirect()) $("msg").textContent = `Sesión iniciada como ${cloud.user().email}.`; }
  catch (e) { $("msg").textContent = `No se pudo entrar con Google: ${e.message}`; }
  sync();
  setTimeout(downloadVoices, 3000);
  autoBackup(); renderBackupReminder();
  rollDay(); store.setSync("kp-day", day);
  renderTop();
});
for (const n of document.querySelectorAll("[data-icon]")) n.insertAdjacentHTML("afterbegin", icon(n.dataset.icon));
renderTop();
openMenu();
