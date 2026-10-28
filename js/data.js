import { VOCAB_N5 } from "./content/vocab-n5.js";
import { KANJI_N5 } from "./content/kanji-n5.js";
import { GRAMMAR_N5 } from "./content/grammar-n5.js";
import { VOCAB_N4 } from "./content/vocab-n4.js";
import { KANJI_N4 } from "./content/kanji-n4.js";
import { GRAMMAR_N4 } from "./content/grammar-n4.js";
import { VOCAB_N3 } from "./content/vocab-n3.js";
import { KANJI_N3 } from "./content/kanji-n3.js";
import { GRAMMAR_N3 } from "./content/grammar-n3.js";

const HIRAGANA = "あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をwo んn"
  .split(" ").map(s => ({ q: s[0], a: s.slice(1) }));

// `level` groups decks for the curriculum and the placement test (kana → N5 → N4 → N3).
// The N5 ids predate levels; they stay as they are so saved progress keeps its keys.
export const DECKS = [
  { id: "hira", name: "Hiragana", kind: "kana", level: "kana", items: HIRAGANA },
  // Katakana sits exactly 0x60 code points after hiragana.
  { id: "kata", name: "Katakana", kind: "kana", level: "kana", items: HIRAGANA.map(i => ({ q: String.fromCharCode(i.q.charCodeAt(0) + 0x60), a: i.a })) },
  { id: "gram5", name: "Gramática N5", kind: "grammar", level: "n5", items: GRAMMAR_N5 },
  { id: "vocab", name: "Vocabulario N5", kind: "vocab", level: "n5", items: VOCAB_N5 },
  { id: "kanji", name: "Kanji N5", kind: "kanji", level: "n5", items: KANJI_N5 },
  { id: "gram4", name: "Gramática N4", kind: "grammar", level: "n4", items: GRAMMAR_N4 },
  { id: "vocab4", name: "Vocabulario N4", kind: "vocab", level: "n4", items: VOCAB_N4 },
  { id: "kanji4", name: "Kanji N4", kind: "kanji", level: "n4", items: KANJI_N4 },
  { id: "gram3", name: "Gramática N3", kind: "grammar", level: "n3", items: GRAMMAR_N3 },
  { id: "vocab3", name: "Vocabulario N3", kind: "vocab", level: "n3", items: VOCAB_N3 },
  { id: "kanji3", name: "Kanji N3", kind: "kanji", level: "n3", items: KANJI_N3 },
];

export const LEVELS = [
  { id: "kana", name: "Kana" }, { id: "n5", name: "N5" }, { id: "n4", name: "N4" }, { id: "n3", name: "N3" },
];
