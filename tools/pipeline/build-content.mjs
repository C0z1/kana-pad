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

// ---------- kanji: KANJIDIC2 old JLPT level 4 (= N5), meanings in Spanish when available ----------
const unDot = r => r.replace(/\./g, "").replace(/-/g, "");
export function kanjiItems(kanjidic) {
  return kanjidic.characters
    .filter(c => c.misc.jlptLevel === 4)
    .sort((a, b) => (a.misc.grade ?? 9) - (b.misc.grade ?? 9) || (a.misc.frequency ?? 9999) - (b.misc.frequency ?? 9999))
    .map(c => {
      const g = c.readingMeaning?.groups?.[0] ?? { readings: [], meanings: [] };
      const on = g.readings.filter(r => r.type === "ja_on").map(r => r.value);
      const kun = g.readings.filter(r => r.type === "ja_kun").map(r => unDot(r.value));
      const es = g.meanings.filter(m => m.lang === "es").map(m => m.value);
      const en = g.meanings.filter(m => m.lang === "en").map(m => m.value);
      return {
        q: c.literal,
        a: (es.length ? es : en).slice(0, 2).join(" / "),
        r: [...new Set([...on.slice(0, 2), ...kun.slice(0, 2)])].join("・"),
        strokes: c.misc.strokeCounts[0],
      };
    });
}

// Meanings must be unique, or two answer bars could both be right.
export function dedupeMeanings(items) {
  const seen = new Map();
  return items.map(it => {
    let a = it.a;
    if (seen.has(a)) a = `${a} (${it.q})`;
    seen.set(a, true);
    return { ...it, a };
  });
}

function writeModule(path, name, items, header) {
  writeFileSync(path, `// ${header}\n// Generado por tools/pipeline/build-content.mjs. No editar a mano.\nexport const ${name} = ${JSON.stringify(items, null, 0).replace(/},{/g, "},\n{")};\n`);
}

if (process.argv[1]?.endsWith("build-content.mjs")) {
  mkdirSync("js/content", { recursive: true });
  const vocab = parseVocab(readFileSync("content/vocab-n5.txt", "utf8"));
  const errors = checkVocab(vocab, load(FILES["jmdict-eng"]));
  if (errors.length) {
    console.error(`${errors.length} problemas en content/vocab-n5.txt:\n` + errors.join("\n"));
    process.exit(1);
  }
  writeModule("js/content/vocab-n5.js", "VOCAB_N5", vocab, "Vocabulario N5: lista y significados propios de Kana Pad (MIT); lecturas verificadas con JMdict.");
  const kanji = dedupeMeanings(kanjiItems(load(FILES["kanjidic2-all"])));
  writeModule("js/content/kanji-n5.js", "KANJI_N5", kanji, "Kanji N5 derivados de KANJIDIC2 (EDRDG, CC BY-SA 4.0): este archivo se distribuye bajo la misma licencia.");
  console.log(`vocabulario: ${vocab.length} palabras · kanji: ${kanji.length}`);
}
