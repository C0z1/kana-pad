import { test } from "node:test";
import assert from "node:assert/strict";
import { heatmap, levelProgress, kindAccuracy, weakest, eta } from "../js/dashboard.js";

const decks = [
  { id: "hira", kind: "kana", level: "kana", name: "Hiragana", items: [{ q: "あ", a: "a" }, { q: "い", a: "i" }] },
  { id: "vocab", kind: "vocab", level: "n5", name: "Vocabulario N5", items: [{ q: "犬", a: "perro" }, { q: "猫", a: "gato" }, { q: "人", a: "persona" }] },
];
const levels = [{ id: "kana", name: "Kana" }, { id: "n5", name: "N5" }];
const mature = { state: 2, scheduled_days: 30, due: "2026-12-01T00:00:00Z" };

test("heatmap: 16 weeks Monday-first, last column holds today, future days are null", () => {
  const cells = heatmap({ "2026-10-28": { answers: 12 } }, "2026-10-28"); // a Wednesday
  assert.equal(cells.length, 112);
  assert.equal(new Date(cells[0].d + "T12:00:00").getDay(), 1); // Monday
  const today = cells.find(c => c.d === "2026-10-28");
  assert.equal(today.n, 12);
  assert.equal(cells.at(-1).n, null); // Sunday after today
  assert.equal(cells.indexOf(today), 105 + 2);
});

test("levelProgress counts seen and mature cards per level", () => {
  const r = levelProgress(decks, { "hira:あ": mature, "vocab:犬": { state: 1, scheduled_days: 0 } }, levels);
  assert.deepEqual(r.map(x => [x.id, x.total, x.seen, x.mature]), [["kana", 2, 1, 1], ["n5", 3, 1, 0]]);
});

test("kindAccuracy mixes deck stats with listening, stories and drawing", () => {
  const r = Object.fromEntries(kindAccuracy(decks, { "vocab:犬": [3, 1] }, { listening: [1, 1], draw: [150, 2] }).map(x => [x.kind, x.rate]));
  assert.equal(r.vocab, 0.75);
  assert.equal(r.kana, null);
  assert.equal(r.listening, 0.5);
  assert.equal(r.draw, 0.75);
});

test("weakest: most-missed first, ignoring cards with few answers or a single miss", () => {
  const r = weakest(decks, { "vocab:犬": [1, 4], "vocab:猫": [2, 2], "vocab:人": [0, 1], "hira:あ": [5, 1] });
  assert.deepEqual(r.map(x => x.q), ["犬", "猫"]);
});

test("eta: remaining cards up to the end of the target level at the recent pace", () => {
  const entries = [...decks[0].items.map(it => ({ key: "hira:" + it.q, deck: decks[0] })), ...decks[1].items.map(it => ({ key: "vocab:" + it.q, deck: decks[1] }))];
  const history = { "2026-10-28": { answers: 10, fresh: 14 } }; // 14 new cards in 2 weeks = 1 a day
  const r = eta(entries, { "hira:あ": mature }, history, "2026-10-28", "n5");
  assert.equal(r.remaining, 4);
  assert.equal(r.days, 4);
  assert.equal(r.date, "2026-11-01");
  assert.equal(eta(entries, {}, {}, "2026-10-28", "n3"), null);
});
