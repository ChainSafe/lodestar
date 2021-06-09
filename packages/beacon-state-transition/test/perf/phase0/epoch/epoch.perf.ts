import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState, initBLS} from "../../util";

export async function runEpochTransitionStepTests(): Promise<void> {
  const runner = new BenchmarkRunner("Epoch transition steps", {
    maxMs: 10 * 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  await initBLS();
  const originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});

  await runner.run({
    id: "prepareEpochProcessState",
    run: () => {
      allForks.prepareEpochProcessState(originalState);
    },
  });

  const process = allForks.prepareEpochProcessState(originalState);

  const testCases = [
    {
      testFunc: phase0.processJustificationAndFinalization as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      name: "processJustificationAndFinalization",
    },
    {
      testFunc: phase0.processRewardsAndPenalties as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      name: "processRewardsAndPenalties",
    },
    {
      testFunc: phase0.processRegistryUpdates as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      name: "processRegistryUpdates",
    },
    {
      testFunc: phase0.processSlashings as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      name: "processSlashings",
    },
    {
      testFunc: phase0.processFinalUpdates as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      name: "processFinalUpdates",
    },
  ];

  for (const {name, testFunc} of testCases) {
    await runner.run({
      id: name,
      beforeEach: () => originalState.clone(),
      run: (state) => testFunc(state, process),
    });
  }
  runner.done();
}
