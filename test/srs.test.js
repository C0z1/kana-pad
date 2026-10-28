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
    for (const field of deck.kind === "grammar" ? ["a"] : ["a", "q"]) {
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

test("options never offer a second correct answer, in either direction", () => {
  for (const deck of DECKS.filter(d => d.kind !== "grammar")) {
    const byA = new Map(deck.items.map(i => [i.a, i.q]));
    for (let n = 0; n < 200; n++) {
      const item = deck.items[n % deck.items.length];
      const reverse = options(deck.items, item, "q");
      // in reverse every option is a written form; only the item's own maps to its meaning
      assert.equal(reverse.filter(q => deck.items.find(i => i.q === q)?.a === item.a).length, 1, deck.id + " " + item.q);
      const forward = options(deck.items, item, "a");
      assert.equal(forward.filter(a => byA.get(a) === item.q).length, 1);
    }
  }
});

test("kanji meanings never contain the kanji", () => {
  for (const it of DECKS.find(d => d.kind === "kanji").items) assert.ok(!it.a.includes(it.q), it.q);
});

test("readings are spoken without okurigana parentheses", async () => {
  const { speakable } = await import("../js/srs.js");
  assert.equal(speakable("いち・ひと(つ)"), "いち、ひとつ");
  assert.ok(!/[()]/.test(speakable("み(っつ)")));
});

test("left stick works as a D-pad past 0.5", async () => {
  const { stickDirs } = await import("../js/gamepad.js");
  assert.deepEqual(stickDirs([0, -0.8]), { 12: true, 13: false, 14: false, 15: false });
  assert.deepEqual(stickDirs([0.6, 0.3]), { 12: false, 13: false, 14: false, 15: true });
  assert.deepEqual(stickDirs([0.4, -0.4]), { 12: false, 13: false, 14: false, 15: false });
});

test("options never offer a distractor that shares a sense with the answer, in both directions", async () => {
  const { DECKS } = await import("../js/data.js");
  const { senses } = await import("../js/srs.js");
  let checked = 0;
  for (const d of DECKS.filter(x => x.kind === "vocab" || x.kind === "kanji")) {
    for (const item of d.items.slice(0, 400)) {
      for (const field of ["a", "q"]) {
        const opts = options(d.items, item, field, () => 0.5);
        const mine = senses(item.a);
        for (const o of opts) {
          if (o === item[field]) continue;
          const other = d.items.find(i => i[field] === o);
          assert.ok(!senses(other.a).some(x => mine.includes(x)), `${d.id}: ${item.q} (${item.a}) vs ${other.q} (${other.a})`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 2000);
  assert.deepEqual(senses("sonar (un timbre), tocar"), ["sonar", "tocar"]);
});
