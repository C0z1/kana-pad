import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { clipHash, clipUrl, BUILT_IN } from "../js/voices.js";
import { allTexts } from "../tools/voices/texts.mjs";

test("clipHash is stable FNV-1a over UTF-8", () => {
  assert.equal(clipHash(""), "811c9dc5");
  assert.equal(clipHash("a"), "e40c292c");
  assert.match(clipHash("こんにちは。カナパッドです。"), /^[0-9a-f]{8}$/);
});

test("every text the app can say has a clip in every built-in voice", () => {
  const missing = [];
  for (const [, text] of Object.entries(allTexts()))
    for (const v of BUILT_IN) if (!existsSync(clipUrl(v, text))) missing.push(`${v.id}: ${text}`);
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} clips faltan: corre tools/voices/generate.py`);
});
