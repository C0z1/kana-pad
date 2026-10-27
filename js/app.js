import { DECKS } from "./data.js";
import { pick, options } from "./srs.js";
import { createPad } from "./gamepad.js";

const KEYS = ["y", "x", "b", "a"]; // top-to-bottom order of the answer bars
const ROUND = 10;
const $ = id => document.getElementById(id);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const todayKey = () => new Date().toLocaleDateString("sv"); // local YYYY-MM-DD
let stats = store.get("kp-stats", {});            // "deck:q" -> [hits, misses]
let day = store.get("kp-day", { d: todayKey(), n: 0 });
if (day.d !== todayKey()) day = { d: todayKey(), n: 0 };
const prefs = { deck: 0, voice: true, ear: false, reverse: false, ...store.get("kp-prefs", {}) };
if (!DECKS[prefs.deck]) prefs.deck = 0;

let screen = "start"; // start | play | pause | summary
let cur = null, opts = [], locked = false, streak = 0, last = null, timer = 0;
let round = { results: [], missed: [] };

const deck = () => DECKS[prefs.deck];
const keyOf = it => deck().id + ":" + it.q;
// Ear mode always asks forward: you hear Japanese and pick the reading/meaning.
const answerField = () => (prefs.reverse && !prefs.ear ? "q" : "a");
const savePrefs = () => store.set("kp-prefs", prefs);
const isKana = () => deck().id === "hira" || deck().id === "kata";

// ---------- rendering ----------
function renderTop() {
  $("decktag").textContent = deck().name.toUpperCase();
  let h = 0, m = 0;
  for (const it of deck().items) { const s = stats[keyOf(it)]; if (s) { h += s[0]; m += s[1]; } }
  $("acc").textContent = h + m ? Math.round((100 * h) / (h + m)) + "%" : "–";
  $("streak").textContent = "×" + streak;
  $("today").textContent = day.n;
  $("ear").setAttribute("aria-pressed", prefs.ear);
  $("reverse").setAttribute("aria-pressed", prefs.reverse);
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
  const q = $("q");
  if (prefs.ear && !revealed) {
    q.className = "glyph ear";
    q.innerHTML = SPEAKER + "<span>Escucha</span>";
  } else if (answerField() === "q") {
    q.className = "glyph latin";
    q.textContent = cur.a;
  } else {
    q.className = "glyph" + (cur.q.length === 2 ? " len2" : cur.q.length > 2 ? " len3" : "");
    q.textContent = cur.q;
  }
}

function next() {
  clearTimeout(timer);
  if (round.results.length >= ROUND) return showSummary();
  const d = deck();
  cur = last = pick(d.items, it => stats[keyOf(it)], Math.random, last);
  opts = options(d.items, cur, answerField());
  showPrompt(false);
  $("hint").textContent = prefs.ear ? "¿Qué escuchaste?" : answerField() === "q" ? "¿Cómo se escribe?" : isKana() ? "¿Cómo se lee?" : "¿Qué significa?";
  $("reading").textContent = "";
  $("verdict").textContent = ""; $("verdict").className = "verdict";
  $("note").textContent = "";
  $("stage").querySelector(".prompt").className = "prompt";
  $("opts").replaceChildren(...KEYS.map((k, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "bar"; b.dataset.k = k;
    const badge = document.createElement("span");
    badge.className = "badge"; badge.dataset.k = k; badge.textContent = k.toUpperCase();
    const label = document.createElement("span");
    label.className = "label" + (answerField() === "q" ? " jp" : "");
    label.textContent = opts[i];
    b.append(badge, label);
    b.addEventListener("click", () => answer(k));
    return b;
  }));
  renderPips();
  locked = false;
  if (answerField() === "a") speak(cur.r || cur.q);
}

function answer(k) {
  if (screen !== "play" || locked || !cur) return;
  locked = true;
  const field = answerField();
  const chosen = opts[KEYS.indexOf(k)];
  const ok = chosen === cur[field];
  const s = stats[keyOf(cur)] || [0, 0];
  s[ok ? 0 : 1]++;
  stats[keyOf(cur)] = s;
  streak = ok ? streak + 1 : 0;
  day.n++;
  round.results.push(ok);
  if (!ok) round.missed.push(cur);
  store.set("kp-stats", stats); store.set("kp-day", day);

  const bars = [...$("opts").children];
  bars.forEach(b => {
    const v = opts[KEYS.indexOf(b.dataset.k)];
    if (v === cur[field]) b.classList.add("right");
    else if (b.dataset.k === k) b.classList.add("wrong");
    else b.classList.add("dim");
  });
  showPrompt(true);
  $("stage").querySelector(".prompt").className = "prompt " + (ok ? "ok" : "bad");
  if (cur.r) $("reading").textContent = cur.r;
  $("verdict").textContent = ok ? "¡CORRECTO!" : "ERA: " + cur[field];
  $("verdict").className = "verdict " + (ok ? "ok" : "bad");
  if (!ok) {
    const picked = deck().items.find(i => i[field] === chosen);
    if (picked) {
      const jp = document.createElement("span");
      jp.className = "jp"; jp.textContent = picked.q;
      $("note").replaceChildren("Tu respuesta: ", jp, ` = ${picked.a}`);
    }
    pad.rumble();
  } else {
    const combo = $("streak").parentElement;
    combo.classList.remove("bump"); void combo.offsetWidth; combo.classList.add("bump");
  }
  if (field === "q") speak(cur.r || cur.q);
  renderTop(); renderPips();
  timer = setTimeout(next, ok ? 800 : 2200);
}

function showSummary() {
  screen = "summary";
  $("stage").hidden = true; $("summary").hidden = false;
  const hits = round.results.filter(Boolean).length;
  $("score").textContent = `${hits} / ${ROUND}`;
  $("missed").replaceChildren(...round.missed.map(it => {
    const li = document.createElement("li");
    const inner = document.createElement("span");
    const jp = document.createElement("span");
    jp.className = "jp"; jp.textContent = it.q;
    inner.append(jp, it.a);
    li.append(inner);
    return li;
  }));
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
  prefs.deck = (i + DECKS.length) % DECKS.length;
  savePrefs(); streak = 0; last = null;
  renderTop();
  if (screen === "play" || screen === "summary") newRound();
}
function toggle(name) {
  prefs[name] = !prefs[name];
  savePrefs(); renderTop();
  if (name === "voice" && !prefs.voice) speechSynthesis?.cancel();
  if ((name === "ear" || name === "reverse") && screen === "play") { last = null; next(); }
}
function setPaused(p) {
  if (p && screen === "play") {
    screen = "pause"; clearTimeout(timer);
    $("starttxt").textContent = "Continuar";
    $("overlay").hidden = false; $("start").focus();
  } else if (!p && (screen === "pause" || screen === "start")) {
    const fresh = screen === "start";
    screen = "play"; $("overlay").hidden = true;
    keepAwake();
    if (fresh) newRound(); else if (locked) next();
  }
}

function speak(text) {
  if (!prefs.voice || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
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

// ---------- input ----------
const ANSWER_BUTTONS = { 0: "a", 1: "b", 2: "x", 3: "y", 12: "y", 13: "a", 14: "x", 15: "b" };
const pad = createPad(i => {
  if (i === 4) return setDeck(prefs.deck - 1);
  if (i === 5) return setDeck(prefs.deck + 1);
  if (i === 8) return toggle("voice");
  if (screen === "start" || screen === "pause") { if (i === 0 || i === 9) setPaused(false); return; }
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
  if (arrows[e.key] && screen === "play") { e.preventDefault(); answer(arrows[e.key]); }
  else if (key === "q") setDeck(prefs.deck - 1);
  else if (key === "e") setDeck(prefs.deck + 1);
  else if (key === "s") toggle("voice");
  else if (key === "o") toggle("ear");
  else if (key === "i") toggle("reverse");
  else if (e.key === "Escape" && (screen === "play" || screen === "pause")) setPaused(screen === "play");
  else if (e.key === "Enter" && screen === "summary") newRound();
});

$("start").addEventListener("click", () => setPaused(false));
$("again").addEventListener("click", newRound);
$("decktag").addEventListener("click", () => setDeck(prefs.deck + 1));
$("ear").addEventListener("click", () => toggle("ear"));
$("reverse").addEventListener("click", () => toggle("reverse"));
$("voice").addEventListener("change", () => toggle("voice"));
$("repad").addEventListener("click", () => { pad.reset(); $("msg").textContent = "Pulsa un botón en el mando que quieras usar."; });

// ---------- progress backup ----------
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "kana-pad", v: 1, stats, day, prefs }, null, 2)], { type: "application/json" });
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
    const valid = data?.app === "kana-pad" && data.stats && typeof data.stats === "object" &&
      Object.values(data.stats).every(v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= 0));
    if (!valid) throw new Error("bad file");
    stats = data.stats; store.set("kp-stats", stats);
    renderTop();
    $("msg").textContent = `Progreso importado: ${Object.keys(stats).length} cartas.`;
  } catch {
    $("msg").textContent = "Ese archivo no es una copia de Kana Pad. Exporta uno desde esta pantalla y vuelve a intentarlo.";
  }
});

setInterval(() => {
  const s = pad.status();
  $("dot").classList.toggle("on", s.on);
  $("padtxt").textContent = s.text;
}, 500);

speechSynthesis?.getVoices();
renderTop();
$("start").focus();
