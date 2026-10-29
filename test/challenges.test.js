import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeQuestion, recordRun, runOver, CHALLENGES } from "../js/challenges.js";
import { DECKS } from "../js/data.js";

const hira = DECKS.find(d => d.id === "hira"), vocab = DECKS.find(d => d.id === "vocab");
const entries = [...hira.items.map(item => ({ item, deck: hira })), ...vocab.items.slice(0, 30).map(item => ({ item, deck: vocab }))];

test("challenge question: 4 distinct options from the same deck, including the answer", () => {
  for (let i = 0; i < 200; i++) {
    const q = challengeQuestion(entries);
    assert.equal(q.opts.length, 4);
    assert.equal(new Set(q.opts).size, 4);
    assert.ok(q.opts.includes(q.answer));
    const deck = entries.find(e => e.item === q.item).deck;
    for (const o of q.opts) assert.ok(deck.items.some(it => it.a === o), `${o} should come from ${deck.id}`);
    assert.equal(q.ask, deck.kind === "kana" ? "¿Cómo se lee?" : "¿Qué significa?");
  }
});

test("challenge question never repeats the previous card", () => {
  let prev = null;
  for (let i = 0; i < 200; i++) { const q = challengeQuestion(entries, Math.random, prev); assert.notEqual(q.item, prev); prev = q.item; }
  // A single-card pool still answers instead of looping forever.
  assert.equal(challengeQuestion(entries.slice(0, 1), Math.random, entries[0].item).item, entries[0].item);
});

test("records: only a higher score replaces the record", () => {
  let r = recordRun({}, "time", 0);
  assert.deepEqual([r.best, r.isNew, r.records.time], [0, false, undefined]);
  r = recordRun(r.records, "time", 12);
  assert.deepEqual([r.best, r.isNew, r.records.time], [12, true, 12]);
  r = recordRun(r.records, "time", 12); // a tie is not a new record
  assert.deepEqual([r.best, r.isNew], [12, false]);
  r = recordRun(r.records, "survival", 5);
  assert.deepEqual(r.records, { time: 12, survival: 5 });
  r = recordRun(r.records, "time", 9);
  assert.deepEqual([r.best, r.isNew, r.records.time], [12, false, 12]);
  assert.deepEqual(recordRun(undefined, "time", 3).records, { time: 3 });
});

test("runs end on the first miss (Supervivencia) or on the clock (Contrarreloj)", () => {
  assert.equal(runOver("survival", true), false);
  assert.equal(runOver("survival", false), true);
  assert.equal(runOver("time", false, 30), false);
  assert.equal(runOver("time", true, 0), true);
  assert.equal(CHALLENGES.time.seconds, 60);
});
