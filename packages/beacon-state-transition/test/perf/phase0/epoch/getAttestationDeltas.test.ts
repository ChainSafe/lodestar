import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../util";

describe("getAttestationDeltas", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  const state = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
  const epochProcess = allForks.beforeProcessEpoch(state);

  itBench(`getAttestationDeltas - ${perfStateId}`, () => {
    phase0.getAttestationDeltas(state, epochProcess);
  });
});
