// The 100 most used kanji for the Guía de trazos: KANJIDIC2's frequency rank (newspaper usage, ranks 1–100),
// written to js/content/kanji-top100.js. Readings and meanings come from Kana Pad's own decks; the kanji no deck
// teaches get their own entry below, checked against KANJIDIC2. Their KanjiVG stroke files are fetched too.
// Run: node tools/pipeline/build-top-kanji.mjs (needs tools/.cache/kanjidic2-all.json from `npm run content`).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { DECKS } from "../../js/data.js";

const EXTRA = { // not in N5–N3: Kana Pad's own reading and meaning (KANJIDIC2: トウ "partido, facción"; シ・うじ "apellido, clan, señor")
  "党": { r: "とう", a: "partido (político)" },
  "氏": { r: "し・うじ", a: "apellido, señor" },
};

const kanjidic = JSON.parse(readFileSync("tools/.cache/kanjidic2-all.json", "utf8"));
const top = kanjidic.characters.filter(c => c.misc.frequency).sort((a, b) => a.misc.frequency - b.misc.frequency).slice(0, 100);
const known = new Map();
for (const d of DECKS.filter(d => d.kind === "kanji")) for (const it of d.items) if (!known.has(it.q)) known.set(it.q, it);

const items = top.map(c => {
  const it = known.get(c.literal) ?? EXTRA[c.literal];
  if (!it) throw new Error(`${c.literal} (#${c.misc.frequency}) no está en los mazos ni en EXTRA`);
  return { q: c.literal, r: it.r, a: it.a, rank: c.misc.frequency, strokes: c.misc.strokeCounts[0] };
});

const file = k => `content/kanjivg/${k.codePointAt(0).toString(16).padStart(5, "0")}.svg`;
for (const { q } of items) if (!existsSync(file(q))) execSync(`curl -sfL -o ${file(q)} https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${file(q).split("/").pop()}`, { stdio: "inherit" });
const list = JSON.parse(readFileSync("content/kanjivg/strokes.json", "utf8"));
for (const { q } of items) if (!list.includes(file(q))) list.push(file(q));
writeFileSync("content/kanjivg/strokes.json", JSON.stringify(list));

writeFileSync("js/content/kanji-top100.js",
  "// Los 100 kanji más usados (rango de frecuencia de KANJIDIC2, uso en periódicos). Generado por tools/pipeline/build-top-kanji.mjs.\n" +
  `export const KANJI_TOP100 = ${JSON.stringify(items)};\n`);
console.log(`js/content/kanji-top100.js: ${items.length} kanji, ${items.filter(i => EXTRA[i.q]).length} fuera de los mazos`);
