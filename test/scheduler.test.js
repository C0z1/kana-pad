import { test } from "node:test";
import assert from "node:assert/strict";
import { grade, queue, nextDue, ratingFor, SLOW_MS } from "../js/scheduler.js";
import { Rating } from "../js/vendor/ts-fsrs.mjs";

const now = new Date("2026-10-27T10:00:00Z");
const later = (c, days) => new Date(now.getTime() + days * 864e5);

test("ratings: wrong = Again, slow = Hard, fast = Good", () => {
  assert.equal(ratingFor(false, 100), Rating.Again);
  assert.equal(ratingFor(true, SLOW_MS + 1), Rating.Hard);
  assert.equal(ratingFor(true, 1000), Rating.Good);
});

test("a remembered card is pushed further out than a forgotten one", () => {
  let good, bad;
  for (let i = 0, t = now; i < 3; i++) {
    good = grade(good, true, 1000, t);
    t = new Date(Date.parse(good.due));
  }
  bad = grade(grade(undefined, true, 1000, now), false, 1000, later(null, 1));
  assert.ok(Date.parse(good.due) > Date.parse(bad.due));
  assert.equal(typeof good.due, "string"); // stored as JSON-friendly ISO strings
});

test("queue: overdue first, then new up to the daily limit", () => {
  const entries = ["a", "b", "c", "d", "e"].map(key => ({ key }));
  const cards = {
    b: { due: "2026-10-26T00:00:00Z" },
    a: { due: "2026-10-20T00:00:00Z" },
    c: { due: "2026-11-30T00:00:00Z" },
  };
  assert.deepEqual(queue(entries, cards, now, 1).map(e => e.key), ["a", "b", "d"]);
  assert.deepEqual(queue(entries, cards, now, 0).map(e => e.key), ["a", "b"]);
  assert.equal(nextDue(cards, now).toISOString(), "2026-11-30T00:00:00.000Z");
});

test("interleave mixes decks by weight and keeps every item", async () => {
  const { interleave } = await import("../js/scheduler.js");
  assert.deepEqual(interleave([["v1", "v2", "v3", "v4"], ["g1"], ["k1", "k2"]], [3, 1, 1]), ["v1", "v2", "v3", "g1", "k1", "v4", "k2"]);
});
