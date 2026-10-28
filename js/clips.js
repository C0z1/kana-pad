// Every text the app can say, as { hash: text }: the voice generator (tools/voices) makes one clip per
// entry, and the app downloads them all for offline use.
import { DECKS } from "./data.js";
import { STORIES_N5 } from "./content/stories-n5.js";
import { parseStory } from "./stories.js";
import { speakable } from "./srs.js";
import { clipHash } from "./voices.js";

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
