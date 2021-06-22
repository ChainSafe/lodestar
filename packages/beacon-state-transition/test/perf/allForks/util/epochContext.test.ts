import {config} from "@chainsafe/lodestar-config/default";
import {BeaconState, Epoch} from "../../../../phase0";
import {CachedBeaconState, createCachedBeaconState} from "../../../../src/allForks";
import {generatePerformanceState} from "../../util";

describe("getCommitteeAssignment perf test group", function () {
  this.timeout(0);

  const numRuns = 1000;
  let perfCumulative = 0;
  let epoch: Epoch, state, cstate: CachedBeaconState<BeaconState>;

  before(() => {
    epoch = 23638;
    state = generatePerformanceState();
    cstate = createCachedBeaconState(config, state);
  });

  after(() => {
    console.log("avg perf: ", perfCumulative / numRuns);
  });

  for (let i = 0; i < numRuns; i++) {
    it("getCommitteeAssignment indivdual test", () => {
      const start = Date.now();
      cstate.getCommitteeAssignment(epoch, 0);
      const perf = Date.now() - start;
      console.log("perf: ", Date.now() - start);
      perfCumulative += perf;
    });
  }
});
