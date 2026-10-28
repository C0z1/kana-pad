// Builds js/content/*.js from content/ sources, checked against JMdict and KANJIDIC2.
// Usage: npm run content   (downloads the dictionaries to tools/.cache on first run)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const CACHE = "tools/.cache";
const RELEASE = "3.6.2+20261026175559"; // scriptin/jmdict-simplified
const FILES = { "jmdict-eng": "jmdict-eng", "kanjidic2-all": "kanjidic2-all" };

function load(name) {
  const path = `${CACHE}/${name}.json`;
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    const url = `https://github.com/scriptin/jmdict-simplified/releases/download/${RELEASE}/${name}-${RELEASE}.json.tgz`;
    execSync(`curl -sfL "${url}" | tar xz -C ${CACHE} && mv ${CACHE}/${name}-3*.json ${path}`, { stdio: "inherit", shell: "bash" });
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------- vocabulary: own list, every word must exist in JMdict with that reading ----------
export function parseVocab(text) {
  return text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const [q, r, a] = l.split("|");
    return { q, r, a };
  });
}

export function checkVocab(words, jmdict) {
  const forms = new Map(); // written form -> Set of readings
  for (const w of jmdict.words) {
    const readings = w.kana.map(k => k.text);
    for (const f of [...w.kanji.map(k => k.text), ...readings]) {
      if (!forms.has(f)) forms.set(f, new Set());
      readings.forEach(r => forms.get(f).add(r));
    }
  }
  const errors = [];
  const seen = new Set();
  for (const w of words) {
    if (!w.q || !w.r || !w.a) errors.push(`línea incompleta: ${JSON.stringify(w)}`);
    else if (seen.has(w.q)) errors.push(`repetida: ${w.q}`);
    else if (!forms.get(w.q)?.has(w.r)) errors.push(`no está en JMdict con esa lectura: ${w.q} (${w.r})`);
    seen.add(w.q);
  }
  return errors;
}

// ---------- kanji: own meanings; the kanji set and readings are checked against KANJIDIC2 ----------
const toHira = t => t.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function parseKanji(text) {
  return parseVocab(text); // same "a|b|c" line format
}

// Every kanji of the level present once, readings attested in KANJIDIC2, meanings unique
// and never containing the kanji itself (that would give the answer away).
// `expected` is the level's kanji set; N5 defaults to KANJIDIC2's old level 4.
export function checkKanji(items, kanjidic, expected, level = "N5") {
  const all = new Map(kanjidic.characters.map(c => [c.literal, c]));
  const set = expected ?? kanjidic.characters.filter(c => c.misc.jlptLevel === 4).map(c => c.literal);
  const dict = new Map(set.map(k => [k, all.get(k)]));
  const errors = [];
  const seenQ = new Set(), seenA = new Set();
  for (const it of items) {
    const c = dict.get(it.q);
    if (!c) { errors.push(`no es un kanji ${level}: ${it.q}`); continue; }
    if (seenQ.has(it.q)) errors.push(`repetido: ${it.q}`);
    if (seenA.has(it.a)) errors.push(`significado repetido: ${it.a} (${it.q})`);
    if (it.a.includes(it.q)) errors.push(`el significado contiene el kanji: ${it.q}`);
    seenQ.add(it.q); seenA.add(it.a);
    const rs = c.readingMeaning?.groups?.[0]?.readings ?? [];
    const on = rs.filter(r => r.type === "ja_on").map(r => toHira(r.value));
    const kun = rs.filter(r => r.type === "ja_kun").map(r => r.value.replace(/[.-]/g, ""));
    for (const reading of it.r.split("・")) {
      const base = reading.replace(/\(.*\)$/, "");
      if (!on.includes(base) && !kun.some(k => k.startsWith(base))) errors.push(`lectura no está en KANJIDIC2: ${it.q} ${reading}`);
    }
  }
  for (const k of dict.keys()) if (!seenQ.has(k)) errors.push(`falta el kanji ${level}: ${k}`);
  return errors;
}

// Meanings must also be unique in vocabulary, or two answer bars could both be right.
export function duplicateMeanings(items) {
  const seen = new Set(), dup = [];
  for (const it of items) { if (seen.has(it.a)) dup.push(it.a); seen.add(it.a); }
  return dup;
}

// ---------- grammar: "lesson|sentence with ＿|answer|d1,d2,d3|translation|note", ordered by lesson ----------
export function parseGrammar(text) {
  return text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const [lesson, q, a, o, t, n] = l.split("|");
    return { l: Number(lesson), q, a, o: (o ?? "").split(","), t, n, r: (q ?? "").replace("＿", a) };
  }).sort((x, y) => x.l - y.l); // stable: keeps the file order within a lesson
}

export function checkGrammar(items) {
  const errors = [], seen = new Set();
  for (const it of items) {
    const id = it.q || JSON.stringify(it);
    if (!Number.isInteger(it.l) || it.l < 1) errors.push(`lección inválida: ${id}`);
    if (!it.q || it.q.split("＿").length !== 2) errors.push(`debe tener un solo hueco ＿: ${id}`);
    if (it.o.length !== 3 || new Set([it.a, ...it.o]).size !== 4) errors.push(`necesita 3 distractores distintos de la respuesta: ${id}`);
    if (!it.t || !it.n) errors.push(`falta traducción o explicación: ${id}`);
    if (seen.has(it.q)) errors.push(`repetida: ${id}`);
    seen.add(it.q);
  }
  return errors;
}

function writeModule(path, name, items, header) {
  writeFileSync(path, `// ${header}\n// Generado por tools/pipeline/build-content.mjs. No editar a mano.\nexport const ${name} = ${JSON.stringify(items, null, 0).replace(/},{/g, "},\n{")};\n`);
}

// N4 and N3 kanji sets come from kanji-data (MIT), minus the kanji of easier levels.
const KANJI_DATA = "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json";
function kanjiSets() {
  const path = `${CACHE}/kanji-data.json`;
  if (!existsSync(path)) execSync(`curl -sfL -o ${path} ${KANJI_DATA}`, { stdio: "inherit" });
  const data = JSON.parse(readFileSync(path, "utf8"));
  return lv => Object.entries(data).filter(([, v]) => v.jlpt_new === lv).map(([k]) => k);
}

// KanjiVG stroke files are fetched once into content/kanjivg (CC BY-SA 3.0, kept unmodified).
const strokeFile = k => `content/kanjivg/${k.codePointAt(0).toString(16).padStart(5, "0")}.svg`;
function fetchStrokes(kanji) {
  for (const k of kanji) {
    const f = strokeFile(k);
    if (!existsSync(f)) execSync(`curl -sfL -o ${f} https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${f.split("/").pop()}`, { stdio: "inherit" });
  }
}

// Each level: vocabulary, kanji and grammar files in content/, one JS module per file in js/content/.
const LEVELS = ["n5", "n4", "n3"];

if (process.argv[1]?.endsWith("build-content.mjs")) {
  mkdirSync("js/content", { recursive: true });
  const jmdict = load(FILES["jmdict-eng"]), kanjidic = load(FILES["kanjidic2-all"]), setOf = kanjiSets();
  const errors = [], built = {}, easier = new Set();
  for (const lv of LEVELS) {
    const N = lv.toUpperCase();
    const vocab = parseVocab(readFileSync(`content/vocab-${lv}.txt`, "utf8"));
    const kanji = parseKanji(readFileSync(`content/kanji-${lv}.txt`, "utf8"));
    const grammar = parseGrammar(readFileSync(`content/grammar-${lv}.txt`, "utf8"));
    const expected = lv === "n5" ? undefined : setOf(Number(lv[1])).filter(k => !easier.has(k));
    errors.push(
      ...checkVocab(vocab, jmdict).map(e => `vocab-${lv}.txt: ${e}`),
      ...duplicateMeanings(vocab).map(a => `vocab-${lv}.txt: significado repetido: ${a}`),
      ...checkKanji(kanji, kanjidic, expected, N).map(e => `kanji-${lv}.txt: ${e}`),
      ...checkGrammar(grammar).map(e => `grammar-${lv}.txt: ${e}`),
    );
    kanji.forEach(k => easier.add(k.q));
    built[lv] = { N, vocab, kanji, grammar };
  }
  if (errors.length) {
    console.error(`${errors.length} problemas:\n` + errors.join("\n"));
    process.exit(1);
  }
  const strokes = [];
  for (const [lv, { N, vocab, kanji, grammar }] of Object.entries(built)) {
    writeModule(`js/content/vocab-${lv}.js`, `VOCAB_${N}`, vocab, `Vocabulario ${N}: lista y significados propios de Kana Pad (MIT); lecturas verificadas con JMdict.`);
    writeModule(`js/content/kanji-${lv}.js`, `KANJI_${N}`, kanji, `Kanji ${N}: lecturas y significados propios de Kana Pad (MIT); conjunto y lecturas verificados con KANJIDIC2.`);
    writeModule(`js/content/grammar-${lv}.js`, `GRAMMAR_${N}`, grammar, `Gramática ${N}: frases, distractores y explicaciones propios de Kana Pad (MIT), ordenados por lección.`);
    fetchStrokes(kanji.map(k => k.q));
    strokes.push(...kanji.map(k => strokeFile(k.q)));
    console.log(`${N} · vocabulario: ${vocab.length} palabras · kanji: ${kanji.length} · gramática: ${grammar.length} frases`);
  }
  // Kana strokes too, for drawing practice (data.js reads the modules written above).
  const { DECKS } = await import("../../js/data.js");
  const kana = DECKS.filter(d => d.kind === "kana").flatMap(d => d.items.map(i => i.q));
  fetchStrokes(kana);
  strokes.push(...kana.map(strokeFile));
  // The service worker precaches these so stroke order works offline for every kanji and kana.
  writeFileSync("content/kanjivg/strokes.json", JSON.stringify(strokes));
}
