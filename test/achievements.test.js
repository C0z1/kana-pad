import { test } from "node:test";
import assert from "node:assert/strict";
import { achievements, bestRun, unseen } from "../js/achievements.js";

const byId = list => Object.fromEntries(list.map(a => [a.id, a]));

test("bestRun: longest run of consecutive days, across month ends", () => {
  assert.equal(bestRun([]), 0);
  assert.equal(bestRun(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-03"]), 3);
  assert.equal(bestRun(["2026-10-01", "2026-10-01"]), 1);
});

test("an empty profile has nothing done, and every achievement has a goal", () => {
  const list = achievements({});
  assert.ok(list.length >= 15);
  assert.equal(list.filter(a => a.done).length, 0);
  for (const a of list) assert.ok(a.progress[1] > 0 && a.name && a.desc && a.icon, a.id);
});

test("each kind of achievement unlocks at its threshold and not before", () => {
  const days = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, { answers: 25 }]));
  let a = byId(achievements({ history: days(2) }));
  assert.equal(a.streak3.done, false);
  assert.deepEqual(a.streak3.progress, [2, 3]);
  a = byId(achievements({ history: days(7), goal: 20 }));
  assert.equal(a.streak7.done, true);
  assert.equal(a.goal7.done, true);
  assert.equal(a.answers100.done, true); // 7 × 25
  assert.equal(a.answers500.done, false);
  a = byId(achievements({ records: { time: 20, survival: 14 }, exams: [{ lv: "n4", pass: true }] }));
  assert.equal(a.time20.done, true);
  assert.equal(a.survival15.done, false);
  assert.equal(a.examN5.done, false); // an N4 pass is not the N5 one
  a = byId(achievements({ decks: [{ id: "hira", total: 46, seen: 46, mature: 46 }, { id: "kanji", total: 80, seen: 60, mature: 0 }, { id: "kanji4", total: 170, seen: 40, mature: 0 }] }));
  assert.equal(a.hira.done, true);
  assert.equal(a.kata.done, false);
  assert.equal(a.kanji100.done, true);
  a = byId(achievements({ stories: Object.fromEntries([1, 2, 3, 4, 5].map(i => [i, { right: 4, total: 4 }])), daily: days(7) }));
  assert.equal(a.stories5.done, true);
  assert.equal(a.daily7.done, true);
});

test("unseen: only done achievements not announced yet", () => {
  const list = achievements({ records: { time: 25, survival: 20 } });
  assert.deepEqual(unseen(list, []).map(a => a.id), ["time20", "survival15"]);
  assert.deepEqual(unseen(list, ["time20"]).map(a => a.id), ["survival15"]);
});
