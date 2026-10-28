import { test } from "node:test";
import assert from "node:assert/strict";
import { DECKS, LEVELS } from "../js/data.js";
import { levelQuestions, startLevel, fromLevel, PER_LEVEL } from "../js/placement.js";
import { seededRng } from "../js/scheduler.js";

test("each level asks six questions from its own decks, with the answer among the options", () => {
  for (const lv of LEVELS) {
    const qs = levelQuestions(DECKS, lv.id, seededRng(lv.id));
    assert.equal(qs.length, PER_LEVEL, lv.id);
    for (const q of qs) {
      assert.equal(q.level, lv.id);
      assert.equal(q.opts.length, 4);
      assert.ok(q.opts.includes(q.answer), q.prompt);
    }
  }
});

test("the first failed level is the start; passing all of them starts at the last", () => {
  assert.equal(startLevel(LEVELS, [6, 4]), "n5");
  assert.equal(startLevel(LEVELS, [3]), "kana");
  assert.equal(startLevel(LEVELS, [6, 5]), null); // keep asking
  assert.equal(startLevel(LEVELS, [6, 6, 6, 6]), "n3");
});

test("starting at a level skips new cards before it but keeps what was already seen", () => {
  const e = (deck, key) => ({ key, deck: { level: deck } });
  const entries = [e("kana", "a"), e("kana", "b"), e("n5", "c"), e("n4", "d")];
  assert.deepEqual(fromLevel(entries, { b: {} }, "n4").map(x => x.key), ["b", "d"]);
  assert.equal(fromLevel(entries, {}, "kana").length, 4);
  assert.equal(fromLevel(entries, {}, undefined).length, 4);
});
