import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPractice, practiceStatus, LEARNING_MAX } from "../js/srs.js";
import { DECKS } from "../js/data.js";

// Simulates free practice of a deck: a taught card gets [0, 0]; asked cards are always right.
function run(items, steps, answerOk = () => true) {
  const stats = {}, log = [];
  let prev = null, lastTaught = false;
  for (let n = 0; n < steps; n++) {
    const { item, teach } = pickPractice(items, i => stats[i.q], i => practiceStatus(stats[i.q]), Math.random, prev, lastTaught);
    if (teach) stats[item.q] ??= [0, 0];
    else { const s = stats[item.q]; s[answerOk(item) ? 0 : 1]++; }
    log.push({ q: item.q, teach });
    prev = item; lastTaught = teach;
  }
  return log;
}

test("free practice never asks a card before teaching it", () => {
  for (const deck of DECKS) {
    const taught = new Set();
    for (const { q, teach } of run(deck.items, 200)) {
      if (teach) { assert.ok(!taught.has(q), `${deck.id}: ${q} taught twice`); taught.add(q); }
      else assert.ok(taught.has(q), `${deck.id}: ${q} asked before being taught`);
    }
  }
});

test("starts by teaching two cards, then alternates and asks", () => {
  const log = run(DECKS[0].items, 6);
  assert.deepEqual(log.slice(0, 3).map(l => l.teach), [true, true, false]);
  assert.equal(log[0].q, "あ");
  for (let i = 2; i < log.length; i++) assert.ok(!(log[i].teach && log[i - 1].teach), "two lessons in a row");
});

test("stops introducing cards while the student keeps failing", () => {
  const log = run(DECKS[0].items, 100, () => false);
  assert.ok(log.filter(l => l.teach).length <= LEARNING_MAX);
});

test("cards learned in the daily review count as known", () => {
  assert.equal(practiceStatus(undefined, undefined), "new");
  assert.equal(practiceStatus(undefined, { state: 2 }), "known");
  assert.equal(practiceStatus(undefined, { state: 1 }), "learning");
  assert.equal(practiceStatus([3, 1]), "known");
  assert.equal(practiceStatus([1, 0]), "learning");
});
