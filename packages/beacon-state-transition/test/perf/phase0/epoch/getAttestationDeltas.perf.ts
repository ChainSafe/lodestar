import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState} from "../../util";

describe("getAttestationDeltas", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  const state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const epochProcess = allForks.prepareEpochProcessState(state);

  itBench("getAttestationDeltas", () => {
    phase0.getAttestationDeltas(state, epochProcess);
  });
});
