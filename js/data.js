import { VOCAB_N5 } from "./content/vocab-n5.js";
import { KANJI_N5 } from "./content/kanji-n5.js";
import { GRAMMAR_N5 } from "./content/grammar-n5.js";

const HIRAGANA = "あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をwo んn"
  .split(" ").map(s => ({ q: s[0], a: s.slice(1) }));

export const DECKS = [
  { id: "hira", name: "Hiragana", kind: "kana", items: HIRAGANA },
  // Katakana sits exactly 0x60 code points after hiragana.
  { id: "kata", name: "Katakana", kind: "kana", items: HIRAGANA.map(i => ({ q: String.fromCharCode(i.q.charCodeAt(0) + 0x60), a: i.a })) },
  { id: "gram5", name: "Gramática N5", kind: "grammar", items: GRAMMAR_N5 },
  { id: "vocab", name: "Vocabulario N5", kind: "vocab", items: VOCAB_N5 },
  { id: "kanji", name: "Kanji N5", kind: "kanji", items: KANJI_N5 },
];
