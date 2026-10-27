import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DECKS } from "../js/data.js";
import { parsePaths, hexOf } from "../js/strokes.js";

test("grammar items: one blank, answer not among distractors, 3 distinct distractors", () => {
  const g = DECKS.find(d => d.kind === "grammar");
  assert.ok(g.items.length >= 30);
  for (const it of g.items) {
    assert.equal(it.q.split("＿").length, 2, it.q);
    assert.equal(it.o.length, 3, it.q);
    assert.equal(new Set([it.a, ...it.o]).size, 4, it.q);
    assert.ok(it.t && it.n, it.q);
    assert.equal(it.r, it.q.replace("＿", it.a));
  }
});

test("every deck has unique prompts, so progress keys never collide", () => {
  for (const d of DECKS) assert.equal(new Set(d.items.map(i => i.q)).size, d.items.length, d.id);
});

test("every kanji has a KanjiVG file with strokes", () => {
  for (const it of DECKS.find(d => d.kind === "kanji").items) {
    const f = `content/kanjivg/${hexOf(it.q)}.svg`;
    assert.ok(existsSync(f), f);
    assert.ok(parsePaths(readFileSync(f, "utf8")).length > 0, f);
  }
  assert.equal(parsePaths(readFileSync("content/kanjivg/05b66.svg", "utf8")).length, 8); // 学
});

test("service worker precaches files that exist", () => {
  const sw = readFileSync("sw.js", "utf8");
  const list = JSON.parse(sw.match(/const APP = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]").replace(/"/g, '"'));
  for (const f of list) if (f !== "./") assert.ok(existsSync(f), f);
});

test("every N5 kanji stroke file is listed for offline precache", () => {
  const list = JSON.parse(readFileSync("content/kanjivg/n5.json", "utf8"));
  assert.equal(list.length, DECKS.find(d => d.kind === "kanji").items.length);
  for (const f of list) assert.ok(existsSync(f), f);
});
