import {init} from "@chainsafe/bls";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState} from "../../util";

export async function runGetAttestationDeltaTest(): Promise<void> {
  const runner = new BenchmarkRunner("getAttestationDeltas", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  await init("blst-native");
  const state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const epochProcess = allForks.prepareEpochProcessState(state);

  await runner.run({
    id: "getAttestationDeltas",
    run: () => {
      phase0.getAttestationDeltas(state, epochProcess);
    },
  });

  runner.done();
}
