import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DECKS } from "../js/data.js";
import { parsePaths, hexOf } from "../js/strokes.js";
import { KANJI_TOP100 } from "../js/content/kanji-top100.js";

test("grammar items: one blank, answer not among distractors, 3 distinct distractors", () => {
  const g = DECKS.find(d => d.kind === "grammar");
  assert.ok(g.items.length >= 80);
  assert.deepEqual(g.items.map(i => i.l), [...g.items.map(i => i.l)].sort((a, b) => a - b)); // new cards follow the lessons
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
  for (const it of DECKS.filter(d => d.kind === "kanji").flatMap(d => d.items)) {
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

test("every kanji and kana stroke file is listed for offline precache (decks and the 100 most used kanji)", () => {
  const list = JSON.parse(readFileSync("content/kanjivg/strokes.json", "utf8"));
  const chars = new Set([...DECKS.filter(d => d.kind === "kanji" || d.kind === "kana").flatMap(d => d.items.map(i => i.q)), ...KANJI_TOP100.map(k => k.q)]);
  assert.equal(list.length, chars.size);
  for (const ch of chars) assert.ok(list.includes(`content/kanjivg/${hexOf(ch)}.svg`), ch);
  for (const f of list) assert.ok(existsSync(f), f);
});

test("the 100 most used kanji: ranks 1–100 in order, no repeats, a reading and a meaning each", () => {
  assert.equal(KANJI_TOP100.length, 100);
  assert.deepEqual(KANJI_TOP100.map(k => k.rank), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(new Set(KANJI_TOP100.map(k => k.q)).size, 100);
  for (const k of KANJI_TOP100) assert.ok(k.r && k.a && k.strokes > 0, k.q);
  assert.deepEqual(KANJI_TOP100.slice(0, 5).map(k => k.q), ["日", "一", "国", "会", "人"]);
});
