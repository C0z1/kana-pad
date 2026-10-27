import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExam, scoreExam, clock } from "../js/exam.js";
import { VOCAB_N5 } from "../js/content/vocab-n5.js";
import { GRAMMAR_N5 } from "../js/content/grammar-n5.js";
import { READING_N5 } from "../js/content/reading-n5.js";

const exam = buildExam(VOCAB_N5, GRAMMAR_N5, READING_N5);

test("exam: 10 vocabulary, 10 grammar, 10 reading, each with 4 distinct options including the answer", () => {
  assert.equal(exam.length, 30);
  for (const [s, n] of [["vocab", 10], ["gram", 10], ["read", 10]]) assert.equal(exam.filter(q => q.section === s).length, n);
  for (const q of exam) {
    assert.equal(q.opts.length, 4);
    assert.equal(new Set(q.opts).size, 4);
    assert.ok(q.opts.includes(q.answer));
  }
});

test("scoring per section and pass rule", () => {
  const all = scoreExam(exam, exam.map(q => q.answer));
  assert.equal(all.right, 30);
  assert.ok(all.pass);
  // perfect vocabulary and grammar, no reading: 20/30 total but reading 0% → fail
  const noReading = scoreExam(exam, exam.map(q => (q.section === "read" ? undefined : q.answer)));
  assert.deepEqual([noReading.per.vocab.right, noReading.per.gram.right, noReading.per.read.right], [10, 10, 0]);
  assert.equal(noReading.pass, false);
  assert.equal(noReading.per.read.missed.length, 10);
  // 18/30 with every section ≥ 40% → pass
  const answers = exam.map((q, i) => (i % 5 < 3 ? q.answer : undefined));
  const r = scoreExam(exam, answers);
  assert.equal(r.right, 18);
  assert.ok(r.pass);
});

test("timer format", () => {
  assert.equal(clock(1200), "20:00");
  assert.equal(clock(59), "0:59");
});
