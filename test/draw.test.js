import { test } from "node:test";
import assert from "node:assert/strict";
import { resample, fit, grade, verdict } from "../js/draw.js";

// 十: a horizontal stroke, then a vertical one.
const JU = [[[20, 50], [90, 50]], [[55, 15], [55, 95]]];

test("resample spaces points evenly", () => {
  const r = resample([[0, 0], [10, 0], [100, 0]], 11);
  assert.equal(r.length, 11);
  assert.deepEqual(r.map(p => Math.round(p[0])), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
});

test("a copy drawn at another size and place still scores 100", () => {
  const small = JU.map(s => s.map(([x, y]) => [x / 3 + 200, y / 3 + 7]));
  assert.deepEqual(fit(small, JU).flat().map(p => p.map(Math.round)), JU.flat());
  assert.equal(grade(small, JU).score, 100);
});

test("wrong order, wrong direction and missing strokes lower the score", () => {
  const perfect = grade(JU, JU).score;
  const swapped = grade([JU[1], JU[0]], JU);
  const backwards = grade([[...JU[0]].reverse(), JU[1]], JU);
  const missing = grade([JU[0]], JU);
  assert.equal(perfect, 100);
  assert.ok(swapped.score < 40, `orden: ${swapped.score}`);
  assert.ok(backwards.strokes[0].reversed && backwards.score < 80 && backwards.score > 60, `dirección: ${backwards.score}`);
  assert.ok(missing.score <= 50, `falta: ${missing.score}`);
  assert.deepEqual(missing.count, [1, 2]);
});

test("a shaky but right drawing still passes", () => {
  const shaky = [[[22, 53], [50, 47], [88, 52]], [[57, 17], [53, 60], [56, 93]]];
  assert.ok(grade(shaky, JU).score >= 65, String(grade(shaky, JU).score));
  assert.equal(verdict(90), "Excelente");
  assert.equal(verdict(10), "Inténtalo de nuevo");
});

test("an empty model or degenerate strokes never give NaN", () => {
  assert.equal(grade(JU, []).score, 0);
  const dot = grade([[[50, 50]], [[50, 50], [50, 50]]], JU);
  assert.ok(Number.isFinite(dot.score), String(dot.score));
});
