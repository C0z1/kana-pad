import { DECKS, LEVELS } from "./data.js";
import { pick, options, speakable } from "./srs.js";
import { createPad } from "./gamepad.js";
import { grade, queue, nextDue, interleave, sanitizeCards, newCardsToday, studyDay, dayEnd, pickNext, NEW_PER_DAY, BREATHER_CARDS, BREATHER_MS } from "./scheduler.js";
import { store } from "./storage.js";
import { strokePaths, strokeSvg, STROKE_SECONDS } from "./strokes.js";
import { retention, streakDays, deckStats, forecast, backupDue, daysSince } from "./progress.js";
import { buildExam, scoreExam, clock, SECTIONS, EXAM_SECONDS } from "./exam.js";
import { READING_N5 } from "./content/reading-n5.js";
import { STORIES_N5 } from "./content/stories-n5.js";
import { parseWord, parseStory, lookupWord } from "./stories.js";
import { activeVoices, pickVoice, voiceVariation, buildListening } from "./listening.js";
import { BUILT_IN, clipUrl, clipPath } from "./voices.js";
import { readBackup } from "./backup.js";
import { allTexts } from "./clips.js";
import { levelQuestions, startLevel, fromLevel, PER_LEVEL } from "./placement.js";
import { grade as gradeDrawing, verdict, pathPoints } from "./draw.js";
import { shuffle } from "./srs.js";

const KEYS = ["y", "x", "b", "a"]; // top-to-bottom order of the answer bars
const ROUND = 10;
const $ = id => document.getElementById(id);

// "Repaso de hoy" mixes every deck through FSRS; the other entries are free practice per deck.
const REVIEW = { id: "review", name: "Repaso de hoy", kind: "review" };
// Free practice over everything already seen; it never touches the FSRS schedule.
const PRACTICE = { id: "seen", name: "Práctica de lo visto", kind: "practice" };
const MODES = [REVIEW, PRACTICE, ...DECKS];
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
    return e ? { item: e.item, deck: e.deck } : null;
  }
  if (mode() === PRACTICE) {
    const seen = seenEntries();
    if (!seen.length) return null;
    const prev = seen.find(e => e.key === lastKey);
    const e = pick(seen, x => stats[x.key], Math.random, prev);
    return { item: e.item, deck: e.deck };
  }
  const deck = mode();
  const prev = deck.items.find(i => keyOf(deck, i) === lastKey);
  return { item: pick(deck.items, it => stats[keyOf(deck, it)], Math.random, prev), deck };
}

function next() {
  clearTimeout(timer);
  studyCard = 0;
  rollDay();
  if (round.results.length >= ROUND) return showSummary();
  cur = nextCard();
  if (!cur) return showSummary();
  lastKey = keyOf(cur.deck, cur.item);
  teaching = isReview() && !cards[lastKey];
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
  if (document.activeElement === document.body) $("opts").querySelector(".bar")?.focus({ preventScroll: true });
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
    day.fresh++; day.n++; countAnswer();
    cards[key] = grade(undefined, true, 0);
    saveCards(); store.setSync("kp-day", day);
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
    saveCards();
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
  screen = "summary";
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
    else if (screen === "play") $("opts").querySelector(".bar")?.focus({ preventScroll: true });
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
  { id: "hoy", name: "Hoy" }, { id: "practicar", name: "Practicar" }, { id: "leer", name: "Leer y oír" },
  { id: "retos", name: "Retos" }, { id: "progreso", name: "Progreso" }, { id: "ajustes", name: "Ajustes" },
];
const menu = { cat: 0, sel: 0, focus: "panel", sub: null }; // sub: "voices", a page inside Ajustes

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

function menuRows() {
  if (menu.sub === "voices") return voiceRows();
  const id = CATS[menu.cat].id, last = exams.at(-1), start = prefs.level ?? "kana";
  if (id === "hoy") {
    const limit = day.limit ?? NEW_PER_DAY;
    return [
      ...(screen === "pause" ? [{ label: "Continuar", sub: "Volver a donde estabas", action: () => setPaused(false) }] : []),
      { label: "Repaso de hoy", count: String(pending()), action: () => startMode(0),
        sub: `${pending()} pendientes · ${day.fresh} de ${newLimit()} nuevas · desde ${levelName(start)}` + (limit < NEW_PER_DAY ? " · FRENO: hoy entran menos nuevas" : "") },
      ...(!prefs.level ? [{ label: "Prueba de nivel", sub: "Unas preguntas para saber desde dónde empezar", action: startPlacement }] : []),
    ];
  }
  if (id === "practicar") {
    const order = [start, ...LEVELS.map(l => l.id).filter(l => l !== start)];
    return [
      { label: "Todo lo visto", count: String(seenEntries().length), sub: "Sin cartas nuevas · no cambia tu calendario", action: () => startMode(1) },
      { label: "Dibujar", sub: "Kana y kanji con el dedo o el ratón, con calificación", action: startDraw },
      ...order.flatMap(lv => DECKS.flatMap((d, i) => {
        if (d.level !== lv) return [];
        const acc = accuracyOf(d), tried = acc !== "–";
        return [{ group: levelName(lv) + (lv === start ? " · tu nivel" : ""), label: d.name, count: tried ? acc : "",
          sub: `${d.items.length} cartas` + (tried ? ` · ${acc} de aciertos` : " · sin practicar"), action: () => startMode(i + 2) }];
      })),
    ];
  }
  if (id === "leer") return [
    { label: "Cuentos", count: newStories() ? String(newStories()) : "", sub: `${STORIES_N5.length} cuentos · ${newStories()} sin leer · guarda palabras mientras lees`, action: openStories },
    { label: "Listening", sub: `Escucha y elige qué dijo la voz · ${listenVoices().length} voces activas`, action: startListening },
  ];
  if (id === "retos") return [
    { label: "Simulacro N5", sub: (last ? `Último: ${last.right}/${last.total} · ${last.pass ? "aprobado" : "no aprobado"} · ` : "") + "20 minutos, 30 preguntas", action: startExam },
  ];
  if (id === "progreso") return [
    { label: "Ver progreso", count: String(streakDays(history, day.d)), sub: "Días seguidos · retención, mazos y próximos 7 días", action: openProgress },
  ];
  const lv = Math.max(0, LEVELS.findIndex(l => l.id === start));
  const setLevel = d => {
    const to = Math.max(0, Math.min(LEVELS.length - 1, lv + d));
    if (to === lv) return false;
    prefs.level = LEVELS[to].id; savePrefs(); renderMenu();
  };
  const voice = () => { toggle("voice"); renderMenu(); };
  const voiceTo = d => { if ((d < 0) === prefs.voice) return false; voice(); }; // ← SÍ, → NO
  return [
    { group: "Voz", label: "Leer cada carta en voz alta", seg: { options: ["SÍ", "NO"], on: prefs.voice ? 0 : 1 }, action: voice, change: voiceTo },
    { group: "Voz", label: "Voces del listening", sub: `${listenVoices().length} activas`, count: "›", action: openVoices },
    ...(tauri ? [] : [{ group: "Voz", id: "voicesdl", label: "Voces sin conexión", sub: voicesDlText(), action: downloadVoices }]),
    { group: "Nivel", label: "Punto de partida", sub: "Desde dónde entran cartas nuevas al repaso", seg: { options: LEVELS.map(l => l.name.toUpperCase()), on: lv }, action: () => setLevel(lv === LEVELS.length - 1 ? -lv : 1), change: setLevel },
    { group: "Nivel", label: "Repetir prueba de nivel", sub: "Unas preguntas por nivel", action: startPlacement },
    { group: "Mando y datos", label: "Usar otro mando", sub: "Después pulsa un botón en el mando nuevo", action: () => { pad.reset(); $("msg").textContent = "Pulsa un botón en el mando que quieras usar."; } },
    { group: "Mando y datos", label: "Exportar progreso", sub: "Guarda una copia en un archivo", action: exportProgress },
    ...(pendingImport ? [
      { group: "Mando y datos", label: "Confirmar importación", sub: `Reemplaza tus ${Object.keys(cards).length} cartas en repaso por las ${Object.keys(pendingImport.r.cards).length} de «${pendingImport.name}»`, action: confirmImport },
      { group: "Mando y datos", label: "Cancelar importación", sub: "Tu progreso no cambia", action: () => { pendingImport = null; $("msg").textContent = ""; renderMenu(); } },
    ] : [{ group: "Mando y datos", label: "Importar progreso", sub: "Elige un archivo exportado; antes de reemplazar nada te pide confirmación", action: () => $("import").click() }]),
    ...(store.getSync("kp-preimport", null) ? [{ group: "Mando y datos", label: "Deshacer la última importación", sub: "Vuelve al progreso que tenías antes", action: undoImport }] : []),
    { group: "Mando y datos", label: "Fuentes y licencias", sub: "KanjiVG, KANJIDIC2, JMdict, Kokoro, ts-fsrs y tipografías", action: () => { $("credits").hidden = !$("credits").hidden; } },
  ];
}

function renderMenu() {
  rollDay();
  const rows = menuRows();
  menu.sel = Math.max(0, Math.min(menu.sel, rows.length - 1));
  const meta = el("span"); const days = streakDays(history, day.d);
  meta.append("Nivel ", el("b", "", prefs.level ? levelName(prefs.level) : "—"), ` · ${days} ${days === 1 ? "día seguido" : "días seguidos"}`);
  $("menulevel").replaceChildren(meta);
  $("mback").hidden = menu.focus === "rail" && screen !== "pause";
  $("menurail").replaceChildren(...CATS.map((c, i) => {
    const b = el("button", "menu-item" + (i !== menu.cat ? "" : menu.focus === "rail" ? " sel" : " on"));
    b.type = "button";
    b.append(el("span", "mlabel", c.name));
    const n = catCount(c.id);
    if (n) b.append(el("span", "mcount", String(n)));
    b.addEventListener("click", () => { menu.cat = i; menu.sel = 0; menu.sub = null; menu.focus = "rail"; $("credits").hidden = true; renderMenu(); });
    return b;
  }));
  $("menupanel").classList.toggle("active", menu.focus === "panel");
  let group = null;
  $("menupanel").replaceChildren(...rows.flatMap((it, i) => {
    const out = [];
    if (it.group && it.group !== group) out.push(el("p", "mgroup", (group = it.group).toUpperCase()));
    const b = el("button", "mrow" + (menu.focus === "panel" && i === menu.sel ? " sel" : ""));
    b.type = "button";
    if (it.id) b.dataset.row = it.id;
    if (it.disabled) b.setAttribute("aria-disabled", "true");
    const label = el("span", "mlabel"); label.append(el("span", "", it.label));
    if (it.sub) label.append(el("span", "msub", it.sub));
    b.append(label);
    if (it.seg) { const s = el("span", "seg"); s.append(...it.seg.options.map((o, k) => el("span", k === it.seg.on ? "on" : "", o))); b.append(s); }
    if (it.count) b.append(el("span", "mcount", it.count));
    b.addEventListener("click", () => { menu.focus = "panel"; menu.sel = i; activateMenu(); });
    out.push(b);
    return out;
  }));
  const focused = menu.focus === "rail" ? $("menurail").children[menu.cat] : $("menupanel").querySelectorAll(".mrow")[menu.sel];
  focused?.focus({ preventScroll: true });
  focused?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function moveMenu(d) {
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
function openVoices() { menu.cat = CATS.findIndex(c => c.id === "ajustes"); menu.focus = "panel"; menu.sub = "voices"; menu.sel = 0; renderMenu(); }
function menuBack() {
  if (menu.sub) { menu.sub = null; menu.sel = 1; renderMenu(); } // back onto "Voces del listening"
  else if (menu.focus === "panel") { menu.focus = "rail"; $("credits").hidden = true; renderMenu(); }
  else if (screen === "pause") setPaused(false);
}
function openMenu() {
  wakeLock?.release().catch(() => {}); wakeLock = null;
  Object.assign(menu, { cat: 0, sel: 0, focus: "panel", sub: null }); $("credits").hidden = true;
  $("overlay").hidden = false; document.querySelector(".app").inert = true;
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
    `Último simulacro (${last.d}): ${last.right}/${last.total} · ${last.pass ? "Aprobado" : "No aprobado"} — vocabulario ${last.per?.vocab?.join("/") ?? "–"}, gramática ${last.per?.gram?.join("/") ?? "–"}, lectura ${last.per?.read?.join("/") ?? "–"}.`));
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
  renderMenu();
}
$("closeprogress").addEventListener("click", closeProgress);
for (const b of $("progress").querySelectorAll(".tab")) b.addEventListener("click", () => setTab(b.dataset.tab));

// ---------- mock exam ----------
let exam = null; // { qs, answers, i, left, paused, timer, from }
let exams = []; // past results, newest last
const deckOf = id => DECKS.find(d => d.id === id);

function startExam() {
  if (screen !== "pause" && screen !== "start") return;
  exam = { qs: buildExam(deckOf("vocab").items, deckOf("gram5").items, READING_N5), answers: [], i: 0, left: EXAM_SECONDS, paused: false, from: screen };
  showExam("SIMULACRO N5");
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
  $("etitle").textContent = title; $("etimer").hidden = !!exam.placement;
  $("eresulttitle").textContent = exam.placement ? "Resultado de la prueba de nivel" : "Resultado del simulacro";
  $("epausetxt").textContent = exam.placement ? "La prueba está en pausa." : "El reloj está detenido.";
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
  $("etimer").classList.toggle("low", exam.left < 60);
}

function renderExamQ() {
  const q = exam.qs[exam.i];
  const n = SECTIONS.findIndex(s => s.id === q.section);
  $("esec").textContent = exam.placement ? `${levelName(LEVELS[exam.lv].id)} · pregunta ${exam.i + 1} de ${exam.qs.length}`
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
  $("epips").replaceChildren(...exam.qs.map((_, i) => el("i", i < exam.i ? "done" : i === exam.i ? "now" : "")));
}

function examAnswer(k) {
  if (!exam || exam.paused || exam.locked || !$("eresult").hidden) return;
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
  if (!exam || !$("eresult").hidden) return; // already finished: never save the same exam twice
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
  renderMenu();
}
$("eback").addEventListener("click", closeExam);
$("epausebtn").addEventListener("click", () => setExamPaused(!exam?.paused));
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
$("lclose").addEventListener("click", closeListening);
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
$("dclose").addEventListener("click", closeDraw);

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
  if (part === "list") $("stitle").textContent = "CUENTOS";
}
function renderStoryList() {
  for (const b of $("stabs").querySelectorAll(".tab")) b.setAttribute("aria-selected", b.dataset.tab === storyTab);
  const list = storiesOf(storyTab);
  storySel = Math.min(storySel, list.length - 1);
  $("slist").replaceChildren(...list.map((st, i) => {
    const b = el("button", "menu-item story-item" + (i === storySel ? " sel" : "")); b.type = "button";
    const label = el("span", "mlabel");
    const jp = el("span", "jp", parseWord(st.title).plain); jp.lang = "ja";
    label.append(jp, el("span", "msub", st.questions.length + " preguntas"));
    const sc = storyScores[st.id];
    b.append(label, el("span", "story-state" + (sc ? "" : " new"), sc ? `${sc.right}/${sc.total}` : "NUEVO"));
    b.addEventListener("click", () => { storySel = i; openStory(); });
    return b;
  }));
  $("slist").children[storySel]?.focus({ preventScroll: true });
}
function moveStoryList(d) { const n = storiesOf(storyTab).length; storySel = (storySel + d + n) % n; renderStoryList(); }
function storyTabBy(d) { storyTab = SCRIPTS[(SCRIPTS.indexOf(storyTab) + d + 3) % 3]; storySel = 0; renderStoryList(); }

function openStory() {
  const st = storiesOf(storyTab)[storySel];
  const lines = parseStory(st.text);
  story = { st, lines, flat: lines.flatMap((ws, li) => ws.map((w, wi) => ({ w, li, wi }))), w: 0, qi: 0, results: [], missed: [] };
  $("stitle").textContent = parseWord(st.title).plain;
  $("sfuri").disabled = st.script !== "kanji";
  $("sfuri").setAttribute("aria-pressed", st.script === "kanji" && prefs.furigana !== false);
  showStoryPart("read");
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
    const add = el("button", "link"); add.type = "button";
    const ab = el("span", "badge", "A"); ab.dataset.k = "a";
    add.append(ab, saved ? "✓ En Repaso" : "Guardar en Repaso"); add.disabled = saved;
    add.addEventListener("click", saveWord);
    panel.push(add);
  } else panel.push(el("small", "", "Esta palabra aún no está en el vocabulario de la app."));
  const say = el("button", "link"); say.type = "button";
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
$("sclose").addEventListener("click", storyBack);
$("sagain").addEventListener("click", () => { storyBack(); });
$("sfuri").addEventListener("click", toggleFurigana);
$("sline").addEventListener("click", () => story && sayLine());
$("squizbtn").addEventListener("click", () => story && startStoryQuiz());
for (const b of $("stabs").querySelectorAll(".tab")) b.addEventListener("click", () => { storyTab = b.dataset.tab; storySel = 0; renderStoryList(); });

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
    else if (i === 1 || i === 9) closeProgress();
    return;
  }
  if (screen === "start" || screen === "pause") {
    if (i === 12) moveMenu(-1);
    else if (i === 13) moveMenu(1);
    else if (i === 0) activateMenu();
    else if (i === 14) menuSide(-1);
    else if (i === 15) menuSide(1);
    else if (i === 2 && menu.sub === "voices") menuRows()[menu.sel]?.test?.();
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
    else if (key === "x" && menu.sub === "voices") menuRows()[menu.sel]?.test?.();
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
$("playback").addEventListener("click", () => setPaused(true));
$("mback").addEventListener("click", menuBack);
$("ear").addEventListener("click", () => toggle("ear"));
$("reverse").addEventListener("click", () => toggle("reverse"));

// ---------- progress backup ----------
const backupJson = () => JSON.stringify({ app: "kana-pad", v: 3, stats, cards, day, prefs, history, exams, stories: storyScores }, null, 2);

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
store.get("kp-cards", {}).then(c => {
  cards = sanitizeCards(c);
  ready = true; renderMenu();
  setTimeout(downloadVoices, 3000);
  autoBackup(); renderBackupReminder();
  rollDay(); store.setSync("kp-day", day);
  renderTop();
});
renderTop();
openMenu();
