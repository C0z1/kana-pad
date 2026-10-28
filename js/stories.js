// Story reader helpers: split a story into lines and words (kana stories put spaces between
// words, like children's books), turn 学校[がっこう] into ruby, and find each word in the vocabulary.

// A word is "学校[がっこう]へ" → segments [{ base: "学校", rt: "がっこう" }, { text: "へ" }].
export function parseWord(raw) {
  const segs = [];
  const re = /([一-鿿々]+)\[([^\]]+)\]|([^[]+?)(?=[一-鿿々]+\[|$)/g;
  for (const m of raw.matchAll(re)) {
    if (m[1]) segs.push({ base: m[1], rt: m[2] });
    else if (m[3]) segs.push({ text: m[3] });
  }
  return {
    segs,
    plain: segs.map(s => s.base ?? s.text).join(""),
    reading: segs.map(s => s.rt ?? s.text).join(""),
  };
}

export function parseStory(text) {
  // Words are separated by spaces; a sentence end (。！？) also ends a word even without a space.
  return text.split("\n").map(line => line.split(/[ 　]+|(?<=[。！？])(?=[^\s。！？」])/).filter(Boolean).map(parseWord));
}

const PUNCT = /[、。「」！？・\s]/g;
// What may follow a dictionary form inside one spaced word: particles and polite/past endings.
const TAILS = ["", "は", "が", "を", "に", "へ", "で", "と", "も", "の", "から", "まで", "や", "ね", "よ", "か",
  "です", "でした", "じゃない", "では", "には", "では", "とも", "にも", "でも", "の", "さん"];
const ICHIDAN_ENDINGS = ["ます", "ました", "ません", "ませんでした", "て", "た", "ない", "たい", "ましょう"];

// Finds the vocabulary item a word stands for, or null. Conservative on purpose: the rest of the
// word after the match must be a particle or a known ending, so いいます is not read as いい.
export function lookupWord(word, vocab) {
  const forms = [word.plain.replace(PUNCT, ""), word.reading.replace(PUNCT, "")];
  let best = null;
  for (const v of vocab) {
    for (const form of forms) {
      for (const key of [v.q, v.r]) {
        if (!key || !form.startsWith(key)) continue;
        if (TAILS.includes(form.slice(key.length)) && (!best || key.length > best.len)) best = { item: v, len: key.length };
      }
      // ichidan verbs (…る): 食べる → 食べます, たべました…
      if (v.r?.endsWith("る")) {
        for (const key of [v.q, v.r]) {
          const stem = key.slice(0, -1);
          if (form.startsWith(stem) && ICHIDAN_ENDINGS.includes(form.slice(stem.length)) && (!best || stem.length > best.len)) best = { item: v, len: stem.length };
        }
      }
    }
  }
  return best?.item ?? null;
}
