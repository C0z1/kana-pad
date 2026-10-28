import { test } from "node:test";
import assert from "node:assert/strict";
import { japaneseVoices, activeVoices, pickVoice, voiceVariation, buildListening } from "../js/listening.js";
import { VOCAB_N5 } from "../js/content/vocab-n5.js";
import { GRAMMAR_N5 } from "../js/content/grammar-n5.js";

const voices = [
  { voiceURI: "haruka", name: "Haruka", lang: "ja-JP" },
  { voiceURI: "ichiro", name: "Ichiro", lang: "ja-JP" },
  { voiceURI: "sayaka", name: "Sayaka", lang: "ja_JP" },
  { voiceURI: "sabina", name: "Sabina", lang: "es-MX" },
];

test("only Japanese voices, and only the enabled ones", () => {
  assert.equal(japaneseVoices(voices).length, 3);
  assert.deepEqual(activeVoices(voices, ["ichiro"]).map(v => v.name), ["Ichiro"]);
  assert.equal(activeVoices(voices, ["borrada"]).length, 3); // stale setting → all
  assert.equal(activeVoices([{ lang: "en-US" }]).length, 0);
});

test("20 questions use at least 2 different voices when 3 are active", () => {
  const used = new Set(Array.from({ length: 20 }, () => pickVoice(activeVoices(voices)).name));
  assert.ok(used.size >= 2);
  assert.equal(pickVoice([]), null);
});

test("a single voice gets varied pitch and rate", () => {
  const a = voiceVariation(1, () => 0), b = voiceVariation(1, () => 0.99);
  assert.notDeepEqual(a, b);
  assert.deepEqual(voiceVariation(3), { pitch: 1, rate: 0.9 });
});

test("listening questions: 4 distinct options with the answer, from reviewed content", () => {
  const qs = buildListening(VOCAB_N5, GRAMMAR_N5, 10);
  assert.equal(qs.length, 10);
  for (const q of qs) {
    assert.equal(q.opts.length, 4);
    assert.equal(new Set(q.opts).size, 4);
    assert.ok(q.opts.includes(q.answer));
    assert.ok(q.say && !q.say.includes("＿"));
  }
});
