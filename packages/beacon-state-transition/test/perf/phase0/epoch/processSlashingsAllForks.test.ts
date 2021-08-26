import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {allForks} from "../../../../src";
import {beforeProcessEpoch} from "../../../../src/allForks";
import {generatePerfTestCachedStatePhase0, numValidators} from "../../util";
import {StateEpoch} from "../../types";

// PERF: Cost 'proportional' to only validators that are slashed. For mainnet conditions:
// - indicesToSlash: max len is 8704. But it's very unlikely since it would require all validators on the same
//   committees to sign slashable attestations.
//
// - On normal mainnet conditions indicesToSlash = 0

describe("phase0 processSlashings", () => {
  setBenchOpts({maxMs: 60 * 1000, minRuns: 5});

  const vc = numValidators;
  const testCases: {id: string; indicesToSlashLen: number}[] = [
    // Normal (optimal) mainnet network conditions: No slashings. Ignore this case since it does nothing
    // {id: "normalcase"},
    // Worst case: All effective balance are updated
    {id: "worstcase", indicesToSlashLen: 8704},
  ];

  // Provide flat `epochProcess.balances` + flat `epochProcess.validators`
  // which will it update validators tree

  for (const {id, indicesToSlashLen} of testCases) {
    itBench<StateEpoch, StateEpoch>({
      id: `phase0 processSlashings - ${vc} ${id}`,
      yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
      before: () => getProcessSlashingsTestData(indicesToSlashLen),
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => allForks.processRegistryUpdates(state, epochProcess),
    });
  }
});

/**
 * Create a state that causes `changeRatio` fraction (0,1) of validators to change their effective balance.
 */
function getProcessSlashingsTestData(
  indicesToSlashLen: number
): {
  state: allForks.CachedBeaconState<allForks.BeaconState>;
  epochProcess: allForks.IEpochProcess;
} {
  const state = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
  const epochProcess = beforeProcessEpoch(state);

  epochProcess.indicesToSlash = linspace(indicesToSlashLen);

  return {
    state: state as allForks.CachedBeaconState<allForks.BeaconState>,
    epochProcess,
  };
}

function linspace(count: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(i);
  return arr;
}
