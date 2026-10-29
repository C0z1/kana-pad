import { test } from "node:test";
import assert from "node:assert/strict";
import { readBackup } from "../js/backup.js";
import { grade } from "../js/scheduler.js";

const card = grade(undefined, true, 1000, new Date("2026-10-01T10:00:00Z"));
const base = { app: "kana-pad", stats: { "hira:あ": [3, 1] }, cards: { "hira:あ": card } };

test("a valid backup comes back with every part", () => {
  const r = readBackup({ ...base, history: { "2026-10-01": { reviews: 2, correct: 1, answers: 5 } },
    exams: [{ d: "2026-10-01", right: 20, total: 30, pass: true, per: { vocab: [8, 10], gram: [7, 10], read: [5, 10] } }],
    stories: { tama: { right: 3, total: 4 } }, prefs: { voice: false, level: "n4", listenVoices: ["kp:jf_alpha"], deck: 2 } }, ["kana", "n5", "n4", "n3"]);
  assert.equal(Object.keys(r.cards).length, 1);
  assert.equal(r.exams.length, 1);
  assert.deepEqual(r.stories, { tama: { right: 3, total: 4 } });
  assert.deepEqual(r.prefs, { voice: false, deck: 2, level: "n4", listenVoices: ["kp:jf_alpha"] });
});

test("files that are not Kana Pad backups are rejected", () => {
  for (const bad of [null, [], { app: "otra" }, { app: "kana-pad", stats: {} }, { ...base, stats: { x: [1] } }, { ...base, cards: [] }])
    assert.throws(() => readBackup(bad));
});

test("damaged optional parts are dropped, not trusted", () => {
  const r = readBackup({ ...base, cards: { "hira:あ": card, "hira:い": { due: "nope" } },
    exams: [{ right: 1, total: 2 }], history: { ayer: {} }, stories: { tama: "x" }, prefs: { level: "n9", voice: "sí", evil: 1 } }, ["kana", "n5"]);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.exams, []); // an exam without per-section scores used to break the progress panel
  assert.equal(r.history, undefined);
  assert.equal(r.stories, undefined);
  assert.deepEqual(r.prefs, {});
});

test("v5 parts: records, Reto del día and announced achievements; v4 files still load", () => {
  const r = readBackup({ ...base, v: 5, records: { time: 18, survival: 7 }, daily: { "2026-10-29": 8 }, achvSeen: ["streak3"] });
  assert.deepEqual(r.records, { time: 18, survival: 7 });
  assert.deepEqual(r.daily, { "2026-10-29": 8 });
  assert.deepEqual(r.achvSeen, ["streak3"]);
  const bad = readBackup({ ...base, records: { time: -1 }, daily: { ayer: 3 }, achvSeen: [1] });
  assert.equal(bad.records, undefined);
  assert.equal(bad.daily, undefined);
  assert.equal(bad.achvSeen, undefined);
  const v4 = readBackup({ ...base, v: 4 });
  assert.equal(v4.records, undefined);
});
