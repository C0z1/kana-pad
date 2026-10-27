import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVocab, checkVocab, duplicateMeanings } from "../tools/pipeline/build-content.mjs";
import { VOCAB_N5 } from "../js/content/vocab-n5.js";
import { KANJI_N5 } from "../js/content/kanji-n5.js";
import { readFileSync } from "node:fs";

const jmdict = { words: [
  { kanji: [{ text: "学生" }], kana: [{ text: "がくせい" }] },
  { kanji: [], kana: [{ text: "はい" }] },
] };

test("vocab check catches wrong readings, unknown words and duplicates", () => {
  const ok = parseVocab("# tema\n学生|がくせい|estudiante\nはい|はい|sí");
  assert.deepEqual(checkVocab(ok, jmdict), []);
  const bad = parseVocab("学生|がくしょう|x\n犬猫|いぬねこ|x\nはい|はい|sí\nはい|はい|sí");
  assert.equal(checkVocab(bad, jmdict).length, 3);
});

test("duplicate kanji meanings get disambiguated", () => {
  const dup = duplicateMeanings([{ q: "少", a: "poco" }, { q: "小", a: "poco" }]);
  assert.deepEqual(dup, ["poco"]);
});

test("generated packs match the source list and stay unique", () => {
  const src = parseVocab(readFileSync("content/vocab-n5.txt", "utf8"));
  assert.deepEqual(VOCAB_N5, src);
  assert.ok(VOCAB_N5.length >= 500);
  assert.equal(KANJI_N5.length, 103);
  assert.equal(new Set(KANJI_N5.map(k => k.a)).size, KANJI_N5.length);
});
