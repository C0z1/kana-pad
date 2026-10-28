// Lists every text the app can say, as { hash: text }, for tools/voices/generate.py.
import { DECKS } from "../../js/data.js";
import { STORIES_N5 } from "../../js/content/stories-n5.js";
import { parseStory } from "../../js/stories.js";
import { speakable } from "../../js/srs.js";
import { clipHash } from "../../js/voices.js";

export function allTexts() {
const texts = new Set(["こんにちは。カナパッドです。"]); // the "test voice" phrase in Settings
for (const d of DECKS) for (const it of d.items) texts.add(it.r || it.q);
for (const st of STORIES_N5) for (const line of parseStory(st.text)) {
  for (const w of line) texts.add(w.reading);
  texts.add(line.map(w => w.reading).join(""));
}
const out = {};
for (const t of texts) {
  const s = speakable(t), h = clipHash(s);
  if (!s.trim()) continue;
  if (out[h] && out[h] !== s) throw new Error(`hash collision: ${out[h]} / ${s}`);
  out[h] = s;
}
return out;
}

if (process.argv[1]?.endsWith("texts.mjs")) process.stdout.write(JSON.stringify(allTexts()));
