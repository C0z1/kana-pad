import { test } from "node:test";
import assert from "node:assert/strict";
import { retention, streakDays, deckStats, forecast } from "../js/progress.js";

const history = {
  "2026-10-23": { reviews: 10, correct: 5, answers: 30 },
  "2026-10-25": { reviews: 20, correct: 18, answers: 40 },
  "2026-10-26": { reviews: 10, correct: 9, answers: 25 },
  "2026-10-27": { reviews: 10, correct: 8, answers: 12 },
};

test("retention uses the last 3 study days including today", () => {
  assert.equal(retention(history, "2026-10-27"), (18 + 9 + 8) / (20 + 10 + 10));
  assert.equal(retention({}, "2026-10-27"), null);
});

test("streak counts consecutive days with answers", () => {
  assert.equal(streakDays(history, "2026-10-27"), 3); // 25, 26, 27 (24 is missing)
  assert.equal(streakDays(history, "2026-10-28"), 3); // today not started yet
  assert.equal(streakDays(history, "2026-10-29"), 0);
});

test("deck stats and 7-day forecast from 20 seeded cards", () => {
  const deck = { id: "v", name: "V", items: Array.from({ length: 30 }, (_, i) => ({ q: "w" + i })) };
  const now = new Date(2026, 9, 27, 12);
  const ends = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 28 + i, 4));
  const cards = {};
  for (let i = 0; i < 20; i++) {
    cards["v:w" + i] = {
      due: new Date(now.getTime() + (i % 7) * 864e5 - (i === 0 ? 3 * 864e5 : 0)).toISOString(),
      state: i < 5 ? 2 : 1,
      scheduled_days: i < 3 ? 30 : 2,
    };
  }
  assert.deepEqual(deckStats([deck], cards), [{ id: "v", name: "V", total: 30, seen: 20, mature: 3 }]);
  const f = forecast(cards, ends);
  assert.equal(f.reduce((a, b) => a + b, 0), 20);
  assert.deepEqual(f, [3, 3, 3, 3, 3, 3, 2]);
});

test("backup reminder after more than 7 days", async () => {
  const { backupDue, daysSince } = await import("../js/progress.js");
  const now = new Date("2026-10-27T12:00:00Z");
  assert.equal(backupDue(undefined, now), true);
  assert.equal(backupDue("2026-10-21T12:00:00Z", now), false); // 6 days
  assert.equal(backupDue("2026-10-19T12:00:00Z", now), true);  // 8 days
  assert.equal(daysSince("2026-10-19T12:00:00Z", now), 8);
});
