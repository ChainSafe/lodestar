import {itBench} from "@dapplion/benchmark";
import {MapDef} from "@lodestar/utils";
import {defaultNetworkOptions} from "../../../../src/network/options.js";
import {RateTracker} from "../../../../src/network/reqresp/rateTracker.js";

/**
 * Ideally we want to sleep between requests to test the prune.
 * But adding sinon mock timer here make it impossible to benchmark.
 */
describe("RateTracker", () => {
  const {rateTrackerTimeoutMs} = defaultNetworkOptions;
  const iteration = 1_000_000;

  // from object count per request make it fit the quota
  // otherwise it's over the quota and it returns for most of requests
  const objectCounts = [1, 2, 4, 8];

  for (const objectCount of objectCounts) {
    itBench({
      id: `RateTracker ${iteration} limit, ${objectCount} obj count per request`,
      beforeEach: () => new RateTracker({limit: iteration, timeoutMs: rateTrackerTimeoutMs}),
      fn: (rateTracker) => {
        for (let i = 0; i < iteration; i++) {
          rateTracker.requestObjects(objectCount);
        }
      },
      runsFactor: iteration,
    });
  }

  // this test the requests that have to do prune() first
  itBench({
    id: "RateTracker with prune",
    beforeEach: () => {
      const requests = new MapDef<number, number>(() => 0);
      const rateTracker = new RateTracker({limit: iteration, timeoutMs: rateTrackerTimeoutMs}, requests);
      for (let i = 0; i < 60; i++) {
        requests.set(i, 1);
      }
      return rateTracker;
    },
    fn: (rateTracker) => {
      rateTracker.requestObjects(1);
    },
  });
});
