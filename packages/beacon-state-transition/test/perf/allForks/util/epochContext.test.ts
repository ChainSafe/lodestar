import {Epoch} from "@chainsafe/lodestar-types";
import {itBench} from "@dapplion/benchmark";
import {computeEpochAtSlot, CachedBeaconStateAllForks} from "../../../../src/index.js";
import {generatePerfTestCachedStatePhase0, numValidators} from "../../util";

// Current implementation scales very well with number of requested validators
// Benchmark data from Wed Jun 30 2021 - Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
//
// ✓ getCommitteeAssignments - req 1 vs - 200000 vc                      225.6465 ops/s    4.431711 ms/op        -       1024 runs   4.54 s
// ✓ getCommitteeAssignments - req 100 vs - 200000 vc                    141.3410 ops/s    7.075087 ms/op        -       1024 runs   7.25 s
// ✓ getCommitteeAssignments - req 1000 vs - 200000 vc                   124.7096 ops/s    8.018632 ms/op        -       1024 runs   8.25 s
describe("epochCtx.getCommitteeAssignments", () => {
  let state: CachedBeaconStateAllForks;
  let epoch: Epoch;

  before(function () {
    this.timeout(60 * 1000);
    state = generatePerfTestCachedStatePhase0();
    epoch = computeEpochAtSlot(state.slot);

    // Sanity check to ensure numValidators doesn't go stale
    if (state.validators.length !== numValidators) throw Error("constant numValidators is wrong");
  });

  // the new way of getting attester duties
  for (const reqCount of [1, 100, 1000]) {
    const validatorCount = numValidators;
    // Space out indexes
    const indexMult = Math.floor(validatorCount / reqCount);
    const indices = Array.from({length: reqCount}, (_, i) => i * indexMult);

    itBench({
      id: `getCommitteeAssignments - req ${reqCount} vs - ${validatorCount} vc`,
      // Only run for 1000 in CI to ensure performance does not degrade
      noThreshold: reqCount < 1000,
      fn: () => {
        state.epochCtx.getCommitteeAssignments(epoch, indices);
      },
    });
  }
});
