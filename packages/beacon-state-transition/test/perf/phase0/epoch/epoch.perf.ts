import {BenchmarkRunner} from "@chainsafe/lodestar-utils";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState, initBLS} from "../../util";

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

let state: allForks.CachedBeaconState<phase0.BeaconState>;

export const runEpochTransitionStepTests = async (): Promise<void> => {
  const runner = new BenchmarkRunner("Epoch transition steps", {
    maxMs: 10 * 60 * 1000,
    runs: 100,
  });
  await initBLS();
  const originalState = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  let process: allForks.IEpochProcess;
  await runner.run({
    id: "prepareEpochProcessState",
    run: () => {
      process = allForks.prepareEpochProcessState(originalState);
    },
  });

  for (const {name, testFunc} of testCases) {
    await runner.run({
      id: name,
      // before: async () => {
      // },
      beforeEach: () => {
        state = originalState.clone();
      },
      run: () => {
        testFunc(state, process);
      },
    });
  }
  runner.done();
};
