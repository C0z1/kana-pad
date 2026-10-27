import { test } from "node:test";
import assert from "node:assert/strict";
import { weight, pick, options, shuffle } from "../js/srs.js";
import { DECKS } from "../js/data.js";

test("misses raise weight, hits lower it", () => {
  assert.equal(weight(), 1);
  assert.ok(weight([0, 2]) > weight([0, 0]));
  assert.ok(weight([4, 0]) < weight([0, 0]));
});

test("pick favours missed cards and avoids the last one", () => {
  const items = [{ q: "a" }, { q: "b" }, { q: "c" }];
  const stats = { a: [0, 10], b: [10, 0], c: [10, 0] };
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 1000; i++) counts[pick(items, i => stats[i.q], rng).q]++;
  assert.ok(counts.a > counts.b * 5);
  for (let i = 0; i < 50; i++) assert.notEqual(pick(items, () => undefined, Math.random, items[0]), items[0]);
});

test("options: four distinct values including the answer", () => {
  for (const deck of DECKS) {
    for (const field of ["a", "q"]) {
      const item = deck.items[3];
      const opts = options(deck.items, item, field);
      assert.equal(opts.length, 4);
      assert.equal(new Set(opts).size, 4);
      assert.ok(opts.includes(item[field]));
    }
  }
});

test("shuffle keeps every element", () => {
  assert.deepEqual(shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
});

test("katakana is derived correctly", () => {
  const kata = DECKS.find(d => d.id === "kata").items;
  assert.equal(kata[0].q, "ア");
  assert.equal(kata.find(i => i.a === "n").q, "ン");
});
