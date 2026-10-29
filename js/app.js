import { DECKS } from "./data.js";
import { pick, options, speakable, pickPractice, practiceStatus } from "./srs.js";
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
// Extra new cards the student asked for today ("5 nuevas más"); the brake still wins at 0.
const newLimit = () => (day.limit === 0 ? 0 : (day.limit ?? NEW_PER_DAY) + (day.bonus ?? 0));
const reviewQueue = () => queue(ENTRIES, cards, new Date(), newLimit() - day.fresh, day.d);
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
  $("ear").setAttribute("aria-pressed", prefs.ear);
  $("reverse").setAttribute("aria-pressed", prefs.reverse);
  $("ear").disabled = grammar || !jaVoice;
  $("ear").title = !jaVoice ? "Instala una voz japonesa: Configuración → Hora e idioma → Voz" : grammar ? "No aplica en gramática" : "";
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
  if (mode() === PRACTICE) {
    const seen = seenEntries();
    if (!seen.length) return null;
    const prev = seen.find(e => e.key === lastKey);
    const e = pick(seen, x => stats[x.key], Math.random, prev);
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
  studyCard = false;
  rollDay();
  if (round.results.length >= ROUND) return showSummary();
  cur = nextCard();
  if (!cur) return showSummary();
  const { item, deck } = cur;
  lastKey = keyOf(deck, item);
  opts = options(deck.items, item, answerField(deck));
  teaching = cur.teach;
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

// After a miss the card stays on screen as a mini lesson until the student moves on.
let studyCard = false;
function answer(k) {
  if (screen === "play" && studyCard) { studyCard = false; next(); return; }
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
      day.fresh++;
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
  renderTop(); renderPips();

  if (deck.kind === "kanji") showStrokes(item.q).then(n => {
    if (!n || screen !== "play" || !ok) return;
    clearTimeout(timer);
    timer = setTimeout(next, Math.max(800, n * STROKE_SECONDS * 1000 + 900));
  });
  if (!ok) {
    studyCard = true;
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
  if (p && (screen === "play" || screen === "summary")) {
    resumeTo = screen;
    screen = "pause"; clearTimeout(timer);
    openMenu();
  } else if (!p && ready && screen === "pause") {
    screen = resumeTo; closeMenu();
    keepAwake();
    if (screen === "play" && locked) next();
  }
}
let resumeTo = "play";

// Starts studying a mode from the menu (0 = Repaso de hoy, 1 = Práctica de lo visto, 2.. = decks).
function startMode(i) {
  if (!ready) return;
  prefs.deck = i; savePrefs(); streak = 0; lastKey = null;
  screen = "play"; closeMenu();
  keepAwake();
  newRound();
}

// ---------- main menu (§9.1) ----------
const menu = { level: "main", sel: 0, from: 0 };
const LEVEL_NAMES = { main: "", practice: "Práctica", settings: "Ajustes", voices: "Voces del listening" };

function accuracyOf(deck) {
  let h = 0, m = 0;
  for (const it of deck.items) { const s = stats[keyOf(deck, it)]; if (s) { h += s[0]; m += s[1]; } }
  return h + m ? `${Math.round((100 * h) / (h + m))}%` : "–";
}

function menuItems() {
  const jaVoices = window.speechSynthesis?.getVoices().filter(v => v.lang?.toLowerCase().startsWith("ja")).length ?? 0;
  const last = exams.at(-1);
  if (menu.level === "practice") {
    return [
      { label: "Práctica de lo visto", count: String(seenEntries().length), sub: "Todo lo que ya viste, sin cartas nuevas", preview: ["Cartas ya vistas de todos los mazos.", "No cambia tu calendario de repasos."], action: () => startMode(1) },
      ...DECKS.map((d, i) => ({ label: d.name, count: accuracyOf(d), sub: `${d.items.length} cartas · ${accuracyOf(d)} de aciertos`, preview: [`${d.items.length} cartas.`, `Aciertos en práctica libre: ${accuracyOf(d)}.`, "Te enseña cada carta nueva antes de preguntarla."], action: () => startMode(i + 2) })),
    ];
  }
  if (menu.level === "voices") {
    const ja = allVoices().filter(v => v.lang?.toLowerCase().startsWith("ja"));
    if (!ja.length) return [{ label: "Sin voz japonesa", disabled: true, sub: "Configuración → Hora e idioma → Voz", preview: ["SIN VOZ: Configuración → Hora e idioma → Voz → Agregar voces → Japonés."] }];
    const active = listenVoices();
    return ja.map(v => ({
      label: `${active.includes(v) ? "✓" : "○"} ${v.name}`, sub: "A: activar o quitar · X: probar", preview: [v.name, "X para escucharla."],
      action: () => {
        const on = active.includes(v);
        if (on && active.length === 1) { $("msg").textContent = "Debe quedar al menos una voz activa."; return; }
        prefs.listenVoices = (on ? active.filter(a => a !== v) : [...active, v]).map(a => a.voiceURI); savePrefs(); renderMenu();
      },
      test: () => sayWith("こんにちは。カナパッドです。", v),
    }));
  }
  if (menu.level === "settings") {
    return [
      { label: `Voz japonesa: ${prefs.voice ? "sí" : "no"}`, sub: jaVoice ? "Lee cada carta en voz alta" : "No hay voz japonesa instalada", preview: [jaVoice ? "Lee cada carta en voz alta." : "Instala una voz japonesa: Configuración → Hora e idioma → Voz."], action: () => { toggle("voice"); renderMenu(); } },
      { label: "Voces del listening", sub: `${listenVoices().length} activas`, preview: ["Elige qué voces japonesas usa el listening."], action: () => openLevel("voices") },
      { label: "Usar otro mando", sub: "Elige el mando con un botón", preview: ["Después pulsa un botón en el mando que quieras usar."], action: () => { pad.reset(); $("msg").textContent = "Pulsa un botón en el mando que quieras usar."; } },
      { label: "Exportar progreso", sub: "Guarda una copia en un archivo", preview: ["Descarga un archivo con todo tu progreso."], action: exportProgress },
      { label: "Importar progreso", sub: "Recupera una copia", preview: ["Elige un archivo exportado antes."], action: () => $("import").click() },
      { label: "Fuentes y licencias", sub: "Datos y tipografías usados", preview: ["KanjiVG, KANJIDIC2, JMdict, ts-fsrs y tipografías."], action: () => { $("credits").hidden = !$("credits").hidden; } },
    ];
  }
  const items = [];
  if (screen === "pause") items.push({ label: "Continuar", sub: "Volver a donde estabas", preview: ["Vuelve a la ronda en curso."], action: () => setPaused(false) });
  const limit = day.limit ?? NEW_PER_DAY;
  items.push(
    { label: "Repaso de hoy", count: String(pending()), sub: `${pending()} pendientes · ${day.fresh}/${newLimit()} nuevas`,
      preview: [`${pending()} cartas pendientes.`, `${day.fresh} de ${newLimit()} cartas nuevas hoy.`, ...(limit < NEW_PER_DAY ? ["FRENO: hoy entran menos cartas nuevas. Mira Progreso."] : [])], action: () => startMode(0) },
    { label: "Práctica", count: String(seenEntries().length), sub: `${seenEntries().length} cartas vistas`, preview: ["Práctica de lo visto o un mazo concreto.", `${seenEntries().length} cartas vistas.`], action: () => openLevel("practice") },
    { label: "Cuentos", count: newStories() ? String(newStories()) : "", sub: `${STORIES_N5.length} cuentos · ${newStories()} nuevos`, preview: ["Cuentos en hiragana, katakana y kanji N5.", `${newStories()} sin leer.`, "Guarda palabras en tu Repaso mientras lees."], action: openStories },
    { label: "Listening", sub: jaVoices ? `${listenVoices().length} de ${jaVoices} voces activas` : "Instala una voz japonesa",
      preview: jaVoices ? ["Escucha y elige qué dijo la voz.", `${listenVoices().length} ${listenVoices().length === 1 ? "voz activa" : "voces activas"}.`, ...(jaVoices === 1 ? ["Con más voces instaladas, el listening varía más."] : [])]
        : ["SIN VOZ: Configuración → Hora e idioma → Voz → Agregar voces → Japonés."], action: startListening },
    { label: "Simulacro N5", sub: last ? `Último: ${last.right}/${last.total}` : "20 minutos, 30 preguntas", preview: [last ? `Último: ${last.right}/${last.total} · ${last.pass ? "Aprobado" : "No aprobado"}.` : "Aún no has hecho ninguno.", "20 minutos, 30 preguntas."], action: startExam },
    { label: "Progreso", sub: `Racha: ${streakDays(history, day.d)} días`, preview: [`Racha: ${streakDays(history, day.d)} días.`, "Retención, mazos y próximos 7 días."], action: openProgress },
    { label: "Ajustes", sub: "Voz, mando, copias de seguridad", preview: ["Voz, mando, copias de seguridad y licencias."], action: () => openLevel("settings") },
  );
  return items;
}

function renderMenu() {
  rollDay();
  const items = menuItems();
  menu.sel = Math.min(menu.sel, items.length - 1);
  $("menulevel").textContent = LEVEL_NAMES[menu.level];
  $("menulist").replaceChildren(...items.map((it, i) => {
    const b = el("button", "menu-item" + (i === menu.sel ? " sel" : ""));
    b.type = "button";
    if (it.disabled) b.setAttribute("aria-disabled", "true");
    const label = el("span", "mlabel"); label.append(el("span", "", it.label), el("span", "msub", it.sub ?? ""));
    b.append(label);
    if (it.count) b.append(el("span", "mcount", it.count));
    const enter = el("span", "menter"); const badge = el("span", "badge", "A"); badge.dataset.k = "a"; enter.append(badge, it.disabled ? "PRONTO" : "ENTRAR");
    b.append(enter);
    b.addEventListener("click", () => { menu.sel = i; activateMenu(); });
    b.addEventListener("focus", () => { if (menu.sel !== i) { menu.sel = i; renderPreview(items); markSel(); } });
    return b;
  }));
  renderPreview(items);
  $("menulist").children[menu.sel]?.focus({ preventScroll: true });
}
function markSel() { [...$("menulist").children].forEach((b, i) => b.classList.toggle("sel", i === menu.sel)); }
function renderPreview(items) {
  const it = items[menu.sel];
  $("menupreview").replaceChildren(el("b", "", it.label), ...it.preview.map(t => el("p", "", t)));
}
function moveMenu(d) {
  const n = $("menulist").children.length;
  menu.sel = (menu.sel + d + n) % n;
  markSel(); renderPreview(menuItems());
  $("menulist").children[menu.sel].focus({ preventScroll: true });
}
function activateMenu() {
  const it = menuItems()[menu.sel];
  if (!it || it.disabled) return;
  it.action();
}
function openLevel(level) { menu.from = menu.sel; menu.level = level; menu.sel = 0; $("credits").hidden = true; renderMenu(); }
function menuBack() {
  if (menu.level === "voices") { menu.level = "settings"; menu.sel = 1; renderMenu(); }
  else if (menu.level !== "main") { menu.level = "main"; menu.sel = menu.from; $("credits").hidden = true; renderMenu(); }
  else if (screen === "pause") setPaused(false);
}
function openMenu() {
  menu.level = "main"; menu.sel = 0; $("credits").hidden = true;
  $("overlay").hidden = false; document.querySelector(".app").inert = true;
  renderMenu(); renderBackupReminder();
}
function closeMenu() { $("overlay").hidden = true; document.querySelector(".app").inert = false; }

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
  renderMenu();
}
$("eback").addEventListener("click", closeExam);

// ---------- listening (§9.2) ----------
const allVoices = () => window.speechSynthesis?.getVoices() ?? [];
const listenVoices = () => activeVoices(allVoices(), prefs.listenVoices ?? []);
let listen = null; // { qs, i, results, voice, locked }

function startListening() {
  if (!listenVoices().length) { openLevel("voices"); return; }
  listen = { qs: buildListening(deckOf("vocab").items, deckOf("gram5").items, 10), i: 0, results: [] };
  screen = "listen";
  $("overlay").hidden = true; $("listen").hidden = false;
  $("lbody").hidden = false; $("lresult").hidden = true;
  renderListenQ();
}

function sayWith(text, voice, slow = false) {
  if (!window.speechSynthesis || !voice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = "ja-JP";
  try { u.voice = voice; } catch {} // a voice that went away falls back to the default Japanese one
  const v = voiceVariation(listenVoices().length);
  u.pitch = v.pitch; u.rate = slow ? 0.7 : v.rate;
  u.onstart = () => $("lwave").classList.add("on");
  u.onend = u.onerror = () => $("lwave").classList.remove("on");
  speechSynthesis.speak(u);
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
  setTimeout(() => {
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
  speechSynthesis?.cancel(); listen = null;
  screen = "start"; $("listen").hidden = true; $("overlay").hidden = false;
  menu.level = "main"; renderMenu();
}
$("lagain").addEventListener("click", startListening);
$("lback").addEventListener("click", closeListening);
$("lrepeat").addEventListener("click", () => listen && sayWith(listen.qs[listen.i]?.say ?? "", listen.voice));
$("lslow").addEventListener("click", () => listen && sayWith(listen.qs[listen.i]?.say ?? "", listen.voice, true));

// ---------- stories (§9.3) ----------
const SCRIPTS = ["hira", "kata", "kanji"];
let storyTab = "hira", storySel = 0, story = null; // { st, lines, flat, w, qi, results, missed }
let storyScores = store.getSync("kp-stories", {});
const storiesOf = tab => STORIES_N5.filter(s => s.script === tab);
const newStories = () => STORIES_N5.filter(s => !storyScores[s.id]).length;

function openStories() {
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
  setTimeout(() => {
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
  speechSynthesis?.cancel(); story = null; showStoryPart("list"); renderStoryList();
}
function closeStories() {
  screen = "start"; $("stories").hidden = true; $("overlay").hidden = false;
  menu.level = "main"; renderMenu();
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
for (const b of $("stabs").querySelectorAll(".tab")) b.addEventListener("click", () => { storyTab = b.dataset.tab; storySel = 0; renderStoryList(); });

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
  if (screen === "listen") {
    if (!$("lresult").hidden) { if (i === 0) startListening(); else if (i === 1 || i === 9) closeListening(); return; }
    if (i === 8) return $("lrepeat").click();
    if (i === 7) return $("lslow").click();
    if (i === 9) return closeListening();
    if (ANSWER_BUTTONS[i]) listenAnswer(ANSWER_BUTTONS[i]);
    return;
  }
  if (screen === "stories") { storyInput(i); return; }
  if (screen === "progress") {
    if (i === 4) setTab(TABS[TABS.indexOf(tab) - 1] ?? TABS.at(-1));
    else if (i === 5) setTab(TABS[TABS.indexOf(tab) + 1] ?? TABS[0]);
    else if (i === 1 || i === 9) closeProgress();
    return;
  }
  if (screen === "start" || screen === "pause") {
    if (i === 12) moveMenu(-1);
    else if (i === 13) moveMenu(1);
    else if (i === 0) activateMenu();
    else if (i === 2 && menu.level === "voices") menuItems()[menu.sel]?.test?.();
    else if (i === 1 || i === 9) menuBack();
    else if (i === 8) { toggle("voice"); renderMenu(); }
    return;
  }
  if (i === 4) return setDeck(prefs.deck - 1);
  if (i === 5) return setDeck(prefs.deck + 1);
  if (i === 8) return toggle("voice");
  if (screen === "summary") { if (i === 0) continueStudy(); else if (i === 2 && !$("morenew").hidden) moreNew(); else if (i === 9) setPaused(true); return; }
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
  if (screen === "listen") {
    if (!$("lresult").hidden) { if (e.key === "Enter") { e.preventDefault(); startListening(); } else if (e.key === "Escape") closeListening(); return; }
    if (e.key === "Escape") return closeListening();
    if (key === "r") return $("lrepeat").click();
    if (key === "l") return $("lslow").click();
    if (arrows[e.key]) { e.preventDefault(); listenAnswer(arrows[e.key]); }
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
    if (key === "q") setTab(TABS[TABS.indexOf(tab) - 1] ?? TABS.at(-1));
    else if (key === "e") setTab(TABS[TABS.indexOf(tab) + 1] ?? TABS[0]);
    else if (e.key === "Escape" || key === "b") closeProgress();
    return;
  }
  if (screen === "start" || screen === "pause") {
    if (e.key === "ArrowUp") { e.preventDefault(); moveMenu(-1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveMenu(1); }
    else if (e.key === "Enter") { e.preventDefault(); activateMenu(); }
    else if (e.key === "Escape" || key === "b") menuBack();
    else if (key === "p") openProgress();
    else if (key === "x") { if (menu.level === "voices") menuItems()[menu.sel]?.test?.(); else startExam(); }
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
const validStats = s => s && typeof s === "object" &&
  Object.values(s).every(v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= 0));

const backupJson = () => JSON.stringify({ app: "kana-pad", v: 2, stats, cards, day, prefs, history, exams }, null, 2);

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
$("import").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== "kana-pad" || !validStats(data.stats) || (data.cards !== undefined && (!data.cards || typeof data.cards !== "object"))) throw new Error("bad file");
    stats = data.stats; store.setSync("kp-stats", stats);
    const count = v => v === undefined || (Number.isInteger(v) && v >= 0);
    if (data.history && typeof data.history === "object" &&
        Object.entries(data.history).every(([d, h]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && h && count(h.reviews) && count(h.correct) && count(h.answers))) {
      history = data.history; store.setSync("kp-hist", history);
    }
    if (Array.isArray(data.exams) && data.exams.every(x => x && Number.isInteger(x.right) && Number.isInteger(x.total))) {
      exams = data.exams.slice(-20); store.set("kp-exams", exams);
    }
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
store.get("kp-exams", []).then(x => { exams = Array.isArray(x) ? x : []; });
store.get("kp-cards", {}).then(c => {
  cards = sanitizeCards(c);
  ready = true; renderMenu();
  autoBackup(); renderBackupReminder();
  rollDay(); store.setSync("kp-day", day);
  renderTop();
});
renderTop();
openMenu();
