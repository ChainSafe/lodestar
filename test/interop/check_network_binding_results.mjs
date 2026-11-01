import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const optionalSamples = new Set([
  "pinned stock gossip Hoodi sample",
  "retained Hoodi bytes round-trip with a supported Fulu response context",
]);

export function checkNetworkBindingResults(results) {
  assert(results.numTotalTests > 0, "network binding suite did not collect tests");
  assert.equal(results.numFailedTests, 0, "network binding tests failed");
  assert.equal(results.numFailedTestSuites, 0, "network binding suites failed");
  let checked = 0;
  for (const suite of results.testResults) {
    for (const test of suite.assertionResults) {
      checked++;
      assert(
        test.status === "passed" || (test.status === "skipped" && optionalSamples.has(test.fullName)),
        `network binding test did not run: ${test.fullName} (${test.status})`
      );
    }
  }
  assert.equal(checked, results.numTotalTests, "network binding results are incomplete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkNetworkBindingResults(JSON.parse(await readFile(process.argv[2], "utf8")));
}
