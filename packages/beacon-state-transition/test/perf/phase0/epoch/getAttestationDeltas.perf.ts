import {BenchmarkRunner} from "@chainsafe/lodestar-utils";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState, initBLS} from "../../util";

export const runGetAttestationDeltaTest = async (): Promise<void> => {
  const runner = new BenchmarkRunner("getAttestationDeltas", {
    maxMs: 10 * 60 * 1000,
    runs: 100,
  });
  await initBLS();
  const state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const epochProcess = allForks.prepareEpochProcessState(state);
  await runner.run({
    id: "getAttestationDeltas",
    run: () => {
      phase0.getAttestationDeltas(state, epochProcess);
    },
  });
  runner.done();
};
