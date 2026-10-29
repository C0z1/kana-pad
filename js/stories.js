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
const ICHIDAN_ENDINGS = ["ます", "ました", "ません", "ませんでした", "て", "た", "たり", "ない", "たい", "ましょう"];
const MASU = ["ます", "ました", "ません", "ませんでした", "ましょう", "たい"];
const TE = ["て", "た", "たり", "ています", "ていました", "てください", "ても"];
const NAI = ["ない", "なかった", "ないで", "なくて", "ないです"];
// Godan verbs (書く, 言う, 帰る…): the last kana changes row before each ending.
const GODAN = {
  う: ["い", "わ", "っ"], く: ["き", "か", "い"], ぐ: ["ぎ", "が", "い"], す: ["し", "さ", "し"], つ: ["ち", "た", "っ"],
  ぬ: ["に", "な", "ん"], ぶ: ["び", "ば", "ん"], む: ["み", "ま", "ん"], る: ["り", "ら", "っ"],
};
const VOICED = new Set(["ぐ", "ぬ", "ぶ", "む"]); // their て/た forms are で/だ: 読んで, 泳いだ
const ADJ = ["く", "くて", "かった", "かったです", "くない", "くないです", "くなかった", "くなかったです", "くなります", "くなりました"];

// The vocabulary has no part of speech; a Spanish infinitive in the meaning ("escribir", "haber, estar")
// marks a verb, so nouns like いつ or 四 are never conjugated (いって is 行く, not いつ + て).
const isVerb = v => /(^|, )\p{L}*(ar|er|ir|ír)(se)?\b/u.test(v.a ?? "");
const IRREGULAR = { する: "し", 来る: "き", くる: "き" }; // して, します / きて, きます

// [stem, endings, bonus] for each way a dictionary form can appear inside one spaced word. The bonus
// breaks ties between matches of the same length: a conjugation beats noun + particle (よんで is 読む,
// not 四 + で) and する/来る beat a regular verb (して is する, not 知る).
function shapes(key, verb) {
  const out = [[key, TAILS, 0]];
  const last = key.at(-1), stem = key.slice(0, -1);
  if (last === "い") out.push([stem, ADJ, 0.5]); // い-adjectives: 白い → 白くて, おいしかった
  if (!verb) return out;
  if (IRREGULAR[key]) return [...out, [IRREGULAR[key], [...MASU, ...TE], 0.75]];
  if (last === "る") out.push([stem, ICHIDAN_ENDINGS, 0.5]); // ichidan: 食べる → 食べます, たべました…
  const g = GODAN[last];
  if (g) {
    const te = key === "いく" || key === "行く" ? "っ" : g[2]; // 行く is the one irregular godan: 行って
    out.push([stem + g[0], MASU, 0.5], [stem + g[1], NAI, 0.5],
      [stem + te, VOICED.has(last) ? TE.map(e => e.replace(/^て/, "で").replace(/^た/, "だ")) : TE, 0.5]);
  }
  return out;
}

// Finds the vocabulary item a word stands for, or null. Conservative on purpose: the rest of the
// word after the match must be a particle or a known ending, so いいます is not read as いい.
export function lookupWord(word, vocab) {
  // "しろくて、ちいさい" is one spaced word: look up the part before the comma.
  const forms = [word.plain, word.reading].map(f => f.split("、")[0].replace(PUNCT, ""));
  let best = null;
  for (const v of vocab) {
    const verb = isVerb(v);
    for (const form of forms) {
      for (const key of [v.q, v.r]) {
        if (!key) continue;
        for (const [stem, endings, bonus] of shapes(key, verb)) {
          const len = stem.length + bonus;
          if (stem && form.startsWith(stem) && endings.includes(form.slice(stem.length)) && (!best || len > best.len)) best = { item: v, len };
        }
      }
    }
  }
  return best?.item ?? null;
}
