import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const script = fileURLToPath(new URL("assert_coverage_report.mjs", import.meta.url));
for (const [name, body, passes] of [
  ["empty report", "", false],
  ["external dependency only", "SF:node_modules/lib/src/index.ts\nLH:10\nend_of_record\n", false],
  ["external nested package", "SF:node_modules/dep/packages/utils/src/bytes.ts\nLH:10\nend_of_record\n", false],
  ["unexecuted package source", "SF:packages/utils/src/bytes.ts\nLH:0\nend_of_record\n", false],
  ["compiled JavaScript only", "SF:packages/utils/lib/bytes.js\nLH:10\nend_of_record\n", false],
  ["executed TypeScript source", "SF:packages/utils/src/bytes.ts\nLH:2\nend_of_record\n", true],
]) {
  test(name, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-coverage-"));
    try {
      const filename = path.join(directory, "lcov.info");
      fs.writeFileSync(filename, body);
      const result = spawnSync(process.execPath, [script, filename], {encoding: "utf8"});
      assert.equal(result.status === 0, passes, result.stderr);
      if (passes) assert.match(result.stdout, /1 executed package TypeScript/);
    } finally {
      fs.rmSync(directory, {recursive: true});
    }
  });
}
