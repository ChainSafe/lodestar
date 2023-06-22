#!/usr/bin/env node

import assert from "node:assert";
import eslintrc from "../.eslintrc.js";

assertSorted(eslintrc.extends, ".extends");
assertSorted(Object.keys(eslintrc.rules), ".rules");
for (const overrides of eslintrc.overrides) {
  assertSorted(Object.keys(overrides.rules), `.overrides ${overrides.files.join(",")}`);
}

/** @param {string[]} keys @param {string} id */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function assertSorted(keys, id) {
  try {
    assert.deepStrictEqual(keys, [...keys].sort());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`Lint error in ${id}\n\n`, e.message);
    process.exit(1);
  }
}
