import { test } from "node:test";
import assert from "node:assert/strict";
import { STORIES_N5 } from "../js/content/stories-n5.js";
import { KANJI_N5 } from "../js/content/kanji-n5.js";

const HIRA = /[ぁ-ゟ]/, KATA = /[ァ-ヿ]/, KANJI = /[一-鿿]/g;
const plain = text => text.replace(/\[[^\]]*\]/g, ""); // drop furigana
const N5 = new Set(KANJI_N5.map(k => k.q));

test("9 stories: 3 per script, each with 3 questions and one right answer", () => {
  for (const s of ["hira", "kata", "kanji"]) assert.equal(STORIES_N5.filter(x => x.script === s).length, 3, s);
  for (const st of STORIES_N5) {
    assert.equal(st.questions.length, 3, st.id);
    for (const q of st.questions) {
      assert.equal(q.o.length, 3);
      assert.equal(new Set([q.a, ...q.o]).size, 4, `${st.id}: ${q.q}`);
    }
  }
});

test("hiragana stories use only hiragana, spaces and punctuation", () => {
  for (const st of STORIES_N5.filter(x => x.script === "hira")) {
    for (const ch of st.text + st.title) assert.ok(HIRA.test(ch) || /[\s、。「」！？ー]/.test(ch), `${st.id}: ${ch}`);
  }
});

test("katakana stories are at least 30% katakana", () => {
  for (const st of STORIES_N5.filter(x => x.script === "kata")) {
    const kana = [...st.text].filter(ch => HIRA.test(ch) || KATA.test(ch));
    const kata = kana.filter(ch => KATA.test(ch));
    assert.ok(kata.length / kana.length >= 0.3, `${st.id}: ${(kata.length / kana.length).toFixed(2)}`);
    assert.ok(!KANJI.test(st.text), st.id);
  }
});

test("kanji stories only use N5 kanji, each word with its reading", () => {
  for (const st of STORIES_N5.filter(x => x.script === "kanji")) {
    for (const k of plain(st.text + st.title).match(KANJI) ?? []) assert.ok(N5.has(k), `${st.id}: ${k}`);
    // every kanji run is followed by [reading]
    for (const m of (st.text + st.title).matchAll(/[一-鿿]+[ぁ-ゟ]*(\[)?/g)) assert.ok(m[1], `${st.id}: ${m[0]} sin lectura`);
  }
});

test("reader: ruby segments, words per line and conservative lookup", async () => {
  const { parseWord, parseStory, lookupWord } = await import("../js/stories.js");
  const { VOCAB_N5 } = await import("../js/content/vocab-n5.js");
  const w = parseWord("学校[がっこう]へ");
  assert.deepEqual(w.segs, [{ base: "学校", rt: "がっこう" }, { text: "へ" }]);
  assert.equal(w.plain, "学校へ");
  assert.equal(w.reading, "がっこうへ");
  assert.equal(parseStory("ねこが います。\nたまは ねます。")[1].length, 2);
  assert.deepEqual(parseStory("ねこが います。なまえは たまです。")[0].map(w => w.plain), ["ねこが", "います。", "なまえは", "たまです。"]);
  assert.equal(lookupWord(parseWord("います。"), VOCAB_N5)?.r, "いる");
  assert.equal(lookupWord(parseWord("学校[がっこう]へ"), VOCAB_N5)?.q, "学校");
  assert.equal(lookupWord(parseWord("いえに"), VOCAB_N5)?.q, "家");
  assert.equal(lookupWord(parseWord("ねこが"), VOCAB_N5)?.q, "猫");
  assert.equal(lookupWord(parseWord("たべました。"), VOCAB_N5)?.q, "食べる");
  assert.equal(lookupWord(parseWord("いいます。"), VOCAB_N5), null); // not いい (bueno)
  // every story parses and every word has text
  for (const st of STORIES_N5) for (const line of parseStory(st.text)) for (const word of line) assert.ok(word.plain, st.id);
});
