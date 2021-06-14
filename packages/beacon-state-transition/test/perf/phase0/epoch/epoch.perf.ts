import {init} from "@chainsafe/bls";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState} from "../../util";

export async function runEpochTransitionStepTests(): Promise<void> {
  const runner = new BenchmarkRunner("Epoch transition steps", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  await init("blst-native");

  const originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const process = allForks.prepareEpochProcessState(originalState);

  await runner.run({
    id: "processJustificationAndFinalization",
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => phase0.processJustificationAndFinalization(state, process),
  });

  await runner.run({
    id: "processRewardsAndPenalties",
    beforeEach: () => originalState.clone(),
    run: (state) => phase0.processRewardsAndPenalties(state, process),
  });

  await runner.run({
    id: "processRegistryUpdates",
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => phase0.processRegistryUpdates(state, process),
  });

  await runner.run({
    id: "processSlashings",
    beforeEach: () => originalState.clone(),
    run: (state) => phase0.processSlashings(state, process),
  });

  await runner.run({
    id: "processFinalUpdates",
    beforeEach: () => originalState.clone(),
    run: (state) => phase0.processFinalUpdates(state, process),
  });

  // Non-action perf

  await runner.run({
    id: "prepareEpochProcessState",
    run: () => {
      allForks.prepareEpochProcessState(originalState);
    },
  });

  runner.done();
}
