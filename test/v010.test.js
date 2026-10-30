// 0.10: Mis errores, Tu semana, Racha protegida and the Anki bridge (pure parts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { streakDays, streakRun } from "../js/progress.js";
import { bestRun, achievements } from "../js/achievements.js";
import { mistakes, weekSummary } from "../js/dashboard.js";
import { plain, notesToItems, ankiId, readDeck, ankiCall } from "../js/anki.js";

const days = list => Object.fromEntries(list.map(d => [d, { answers: 5 }]));

test("racha protegida: one missed day per Monday-Sunday week is jumped, not counted", () => {
  // Wed 21 .. Tue 27 Oct 2026 with Fri 23 missed.
  const h = days(["2026-10-21", "2026-10-22", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.equal(streakDays(h, "2026-10-27"), 4); // unprotected: 24 to 27
  assert.deepEqual(streakRun(h, "2026-10-27", true), { n: 6, saved: 1 });
  // Two missed days in a row break it even when protected.
  assert.equal(streakDays(days(["2026-10-20", "2026-10-23", "2026-10-24"]), "2026-10-24", true), 2);
  // A second missed day in the same week breaks it; one in the week before is fine.
  const twice = days(["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-24"]); // gaps Tue 20 and Thu 22, same week
  assert.equal(streakDays(twice, "2026-10-24", true), 3);
  const twoWeeks = days(["2026-10-15", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-21"]); // gaps Fri 16 (week 12) and Tue 20 (week 19)
  assert.equal(streakDays(twoWeeks, "2026-10-21", true), 5);
  // Missing yesterday while today hasn't started yet keeps the run alive.
  assert.equal(streakDays(days(["2026-10-25", "2026-10-26"]), "2026-10-28", true), 2);
  assert.equal(streakDays(days(["2026-10-25", "2026-10-26"]), "2026-10-28"), 0);
});

test("bestRun with freeze matches the protected streak; achievements use it", () => {
  const list = ["2026-10-21", "2026-10-22", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
  assert.equal(bestRun(list), 4);
  assert.equal(bestRun(list, true), 6);
  assert.equal(bestRun(["2026-10-19", "2026-10-21", "2026-10-23"], true), 2); // second gap in the same week
  const history = days(["2026-10-20", "2026-10-22", "2026-10-23"]);
  assert.equal(achievements({ history }).find(a => a.id === "streak3").done, true);
});

test("mis errores: missed cards at 25% or worse, worst first, capped", () => {
  const e = q => ({ key: "d:" + q, item: { q }, deck: { id: "d" } });
  const entries = ["a", "b", "c", "d", "e"].map(e);
  const stats = { "d:a": [9, 1], "d:b": [1, 3], "d:c": [3, 1], "d:d": [0, 0], "d:e": [1, 1] };
  assert.deepEqual(mistakes(entries, stats).map(x => x.item.q), ["b", "e", "c"]); // a is 10%: under control
  assert.equal(mistakes(entries, stats, 1).length, 1);
  assert.deepEqual(mistakes(entries, {}), []);
});

test("tu semana: last 7 days against the 7 before, with the best day", () => {
  const history = {
    "2026-10-28": { answers: 30, fresh: 5, reviews: 10, correct: 9 },
    "2026-10-23": { answers: 50, fresh: 0 },
    "2026-10-21": { answers: 99 }, // 7 days back: last week
    "2026-10-14": { answers: 1 }, // 14 days back: out
  };
  const w = weekSummary(history, "2026-10-28");
  assert.deepEqual(w.now, { answers: 80, days: 2, fresh: 5, retention: 0.9, best: { d: "2026-10-23", n: 50 } });
  assert.deepEqual(w.prev, { answers: 99, days: 1, fresh: 0, retention: null, best: { d: "2026-10-21", n: 99 } });
});

test("anki: field HTML to plain text, notes to items", () => {
  assert.equal(plain("<b>犬</b>&nbsp;[sound:inu.mp3]"), "犬");
  assert.equal(plain("perro<br>can<div>x</div>"), "perro, canx");
  assert.equal(plain("a &amp; b &lt;c&gt;"), "a & b <c>");
  const note = (f, b) => ({ fields: { Back: { value: b, order: 1 }, Front: { value: f, order: 0 } } });
  assert.deepEqual(notesToItems([note("犬", "perro"), note("犬", "dup"), note("", "x"), note("猫", "<i>gato</i>")]),
    [{ q: "犬", a: "perro" }, { q: "猫", a: "gato" }]);
  assert.match(ankiId("Japonés::N5 vocab"), /^anki-[0-9a-z]+$/);
  assert.equal(ankiId("A"), ankiId("A"));
  assert.notEqual(ankiId("A"), ankiId("B"));
});

test("anki: talks AnkiConnect v6 and surfaces its errors", async () => {
  const calls = [];
  const fake = async (url, { body }) => {
    const { action, version, params } = JSON.parse(body); calls.push([url, action, version, params]);
    const result = action === "findNotes" ? [1, 2] : [{ fields: { F: { value: "水", order: 0 }, B: { value: "agua", order: 1 } } }];
    return { json: async () => ({ result, error: null }) };
  };
  const deck = await readDeck('Mi "mazo"', fake);
  assert.deepEqual(deck.items, [{ q: "水", a: "agua" }]);
  assert.equal(deck.anki, true);
  assert.deepEqual(calls[0], ["http://127.0.0.1:8765", "findNotes", 6, { query: 'deck:"Mi \\"mazo\\""' }]);
  assert.deepEqual(calls[1][3], { notes: [1, 2] });
  await assert.rejects(ankiCall("deckNames", {}, async () => ({ json: async () => ({ result: null, error: "boom" }) })), /boom/);
});
