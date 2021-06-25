import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {config} from "@chainsafe/lodestar-config/default";
import {BeaconState, Epoch} from "../../../../phase0";
import {CachedBeaconState, createCachedBeaconState} from "../../../../src/allForks";
import {generatePerformanceState} from "../../util";

describe.skip("getCommitteeAssignment perf test group", function () {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

  let epoch: Epoch, state, cstate: CachedBeaconState<BeaconState>;

  before(function () {
    this.timeout(60 * 1000);

    epoch = 23638;
    state = generatePerformanceState();
    cstate = createCachedBeaconState(config, state);
  });

  itBench("getCommitteeAssignment", () => {
    cstate.getCommitteeAssignment(epoch, 0);
  });
});
