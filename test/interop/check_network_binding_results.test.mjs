import assert from "node:assert/strict";
import {test} from "node:test";
import {checkNetworkBindingResults} from "./check_network_binding_results.mjs";

function results(fullName, status) {
  return {
    numFailedTestSuites: 0,
    numFailedTests: 0,
    numTotalTests: 1,
    testResults: [{assertionResults: [{fullName, status}]}],
  };
}

test("network CI rejects skipped lifecycle tests and permits only optional retained samples", () => {
  checkNetworkBindingResults(results("owner teardown", "passed"));
  checkNetworkBindingResults(results("pinned stock gossip Hoodi sample", "skipped"));
  assert.throws(() => checkNetworkBindingResults(results("owner teardown", "skipped")), /did not run/);
  assert.throws(
    () => checkNetworkBindingResults(results("pinned stock gossip Hoodi sample", "pending")),
    /did not run/
  );
  assert.throws(() => checkNetworkBindingResults(results("pinned stock gossip Hoodi sample", "failed")), /did not run/);
  assert.throws(
    () => checkNetworkBindingResults({...results("owner teardown", "passed"), numTotalTests: 0}),
    /collect/
  );
});
