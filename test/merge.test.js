import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeProgress, changed } from "../js/merge.js";

const card = (iso, reps) => ({ due: iso, last_review: iso, reps, state: 2, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, lapses: 0, learning_steps: 0 });

test("two devices: each card keeps its latest review, counters their maximum", () => {
  const phone = { stats: { "a": [3, 1] }, cards: { a: card("2026-10-20T10:00:00Z", 3), b: card("2026-10-25T10:00:00Z", 2) },
    history: { "2026-10-25": { answers: 10, reviews: 2, correct: 2 } }, exams: [], stories: { tama: { right: 2, total: 4 } }, kinds: { listening: [3, 1] }, prefs: { level: "n5" } };
  const pc = { stats: { "a": [1, 4], "c": [1, 0] }, cards: { a: card("2026-10-26T10:00:00Z", 4) },
    history: { "2026-10-25": { answers: 4 }, "2026-10-26": { answers: 6 } }, exams: [{ d: "2026-10-26", right: 20, total: 30 }], stories: { tama: { right: 3, total: 4 } }, kinds: { draw: [80, 1] }, prefs: { level: "n4" } };
  const m = mergeProgress(phone, pc);
  assert.equal(m.cards.a.reps, 4); // the PC reviewed it later
  assert.equal(m.cards.b.reps, 2); // only the phone has it
  assert.deepEqual(m.stats.a, [3, 4]);
  assert.deepEqual(m.stats.c, [1, 0]);
  assert.deepEqual(m.history["2026-10-25"], { answers: 10, reviews: 2, correct: 2 });
  assert.equal(m.history["2026-10-26"].answers, 6);
  assert.equal(m.exams.length, 1);
  assert.equal(m.stories.tama.right, 3);
  assert.deepEqual(m.kinds, { listening: [3, 1], draw: [80, 1] });
  assert.equal(m.prefs.level, "n5"); // preferences stay per device
});

test("merging is stable: merging again changes nothing", () => {
  const a = { stats: { x: [1, 0] }, cards: { x: card("2026-10-20T10:00:00Z", 1) }, history: {}, exams: [], stories: {}, kinds: {}, prefs: {} };
  const m = mergeProgress(a, a);
  assert.equal(changed(m, mergeProgress(m, a)), false);
  assert.equal(mergeProgress(a, null), a);
});

test("records and Reto del día keep the best score; announced achievements are joined; N4 exams don't collide with N5", () => {
  const base = { stats: {}, cards: {}, history: {}, stories: {}, kinds: {}, prefs: {} };
  const a = { ...base, exams: [{ d: "2026-10-29", lv: "n5", right: 10, total: 20 }], records: { time: 12 }, daily: { "2026-10-29": 6 }, achvSeen: ["b"] };
  const b = { ...base, exams: [{ d: "2026-10-29", lv: "n4", right: 10, total: 20 }], records: { time: 15, survival: 4 }, daily: { "2026-10-29": 8, "2026-10-28": 5 }, achvSeen: ["a", "b"] };
  const m = mergeProgress(a, b);
  assert.deepEqual(m.records, { time: 15, survival: 4 });
  assert.deepEqual(m.daily, { "2026-10-29": 8, "2026-10-28": 5 });
  assert.deepEqual(m.achvSeen, ["a", "b"]);
  assert.equal(m.exams.length, 2);
  assert.equal(changed(m, mergeProgress(m, b)), false);
});
