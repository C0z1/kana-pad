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

// Every N5 (old level 4) kanji present once, readings attested in KANJIDIC2, meanings unique
// and never containing the kanji itself (that would give the answer away).
export function checkKanji(items, kanjidic) {
  const dict = new Map(kanjidic.characters.filter(c => c.misc.jlptLevel === 4).map(c => [c.literal, c]));
  const errors = [];
  const seenQ = new Set(), seenA = new Set();
  for (const it of items) {
    const c = dict.get(it.q);
    if (!c) { errors.push(`no es un kanji N5 de KANJIDIC2: ${it.q}`); continue; }
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
  for (const k of dict.keys()) if (!seenQ.has(k)) errors.push(`falta el kanji N5: ${k}`);
  return errors;
}

// Meanings must also be unique in vocabulary, or two answer bars could both be right.
export function duplicateMeanings(items) {
  const seen = new Set(), dup = [];
  for (const it of items) { if (seen.has(it.a)) dup.push(it.a); seen.add(it.a); }
  return dup;
}

function writeModule(path, name, items, header) {
  writeFileSync(path, `// ${header}\n// Generado por tools/pipeline/build-content.mjs. No editar a mano.\nexport const ${name} = ${JSON.stringify(items, null, 0).replace(/},{/g, "},\n{")};\n`);
}

if (process.argv[1]?.endsWith("build-content.mjs")) {
  mkdirSync("js/content", { recursive: true });
  const vocab = parseVocab(readFileSync("content/vocab-n5.txt", "utf8"));
  const kanji = parseKanji(readFileSync("content/kanji-n5.txt", "utf8"));
  const errors = [
    ...checkVocab(vocab, load(FILES["jmdict-eng"])).map(e => `vocab-n5.txt: ${e}`),
    ...duplicateMeanings(vocab).map(a => `vocab-n5.txt: significado repetido: ${a}`),
    ...checkKanji(kanji, load(FILES["kanjidic2-all"])).map(e => `kanji-n5.txt: ${e}`),
  ];
  if (errors.length) {
    console.error(`${errors.length} problemas:\n` + errors.join("\n"));
    process.exit(1);
  }
  writeModule("js/content/vocab-n5.js", "VOCAB_N5", vocab, "Vocabulario N5: lista y significados propios de Kana Pad (MIT); lecturas verificadas con JMdict.");
  writeModule("js/content/kanji-n5.js", "KANJI_N5", kanji, "Kanji N5: lecturas y significados propios de Kana Pad (MIT); conjunto y lecturas verificados con KANJIDIC2.");
  console.log(`vocabulario: ${vocab.length} palabras · kanji: ${kanji.length}`);
}
