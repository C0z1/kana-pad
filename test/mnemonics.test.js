import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DECKS } from "../js/data.js";
import { MNEMONICS, SHAPES, mnemonicSvg } from "../js/mnemonics.js";
import { parsePaths, parseNumbers, hexOf } from "../js/strokes.js";

const kvg = ch => readFileSync(`content/kanjivg/${hexOf(ch)}.svg`, "utf8");

test("every mnemonic is an N5 kanji with KanjiVG strokes, a known shape and a colour token the app defines", () => {
  const n5 = new Set(DECKS.find(d => d.id === "kanji").items.map(i => i.q)), css = readFileSync("css/styles.css", "utf8");
  for (const [ch, [shape, token]] of Object.entries(MNEMONICS)) {
    assert.ok(n5.has(ch), `${ch} no está en Kanji N5`);
    assert.ok(existsSync(`content/kanjivg/${hexOf(ch)}.svg`), `${ch} sin archivo KanjiVG`);
    assert.ok(SHAPES[shape], `${ch}: forma ${shape}`);
    assert.ok(css.includes(`${token}: #`), `${ch}: ${token} no está en :root`);
  }
});

test("the card draws the shape first, then every stroke of the character on top", () => {
  const paths = parsePaths(kvg("火")), svg = mnemonicSvg("火", paths);
  assert.equal(paths.length, 4);
  assert.ok(svg.indexOf('class="mshape"') < svg.indexOf('class="mstrokes"'));
  paths.forEach((d, i) => assert.ok(svg.includes(`<path d="${d}" pathLength="1" style="animation-delay:${(i * 0.35).toFixed(2)}s"/>`), `trazo ${i + 1}`));
});

test("stroke numbers come from KanjiVG: one per stroke, 1..n, inside the 109 grid", () => {
  for (const ch of ["火", "水", "あ", "日"]) {
    const t = kvg(ch), nums = parseNumbers(t);
    assert.equal(nums.length, parsePaths(t).length, ch);
    assert.deepEqual(nums.map(x => x.n), nums.map((_, i) => i + 1), ch);
    for (const { x, y } of nums) assert.ok(x >= 0 && x <= 109 && y >= 0 && y <= 109, `${ch} ${x},${y}`);
  }
  assert.deepEqual(parseNumbers(kvg("火"))[0], { n: 1, x: 16.5, y: 32.5 });
});
