import {itBench} from "@dapplion/benchmark";
import {
  phase0,
  beforeProcessEpoch,
  CachedBeaconStatePhase0,
  CachedBeaconStateAllForks,
  EpochProcess,
} from "../../../../src/index.js";
import {generatePerfTestCachedStatePhase0, numValidators} from "../../util";
import {StateEpoch} from "../../types.js";

// PERF: Cost 'proportional' to only validators that are slashed. For mainnet conditions:
// - indicesToSlash: max len is 8704. But it's very unlikely since it would require all validators on the same
//   committees to sign slashable attestations.
//
// - On normal mainnet conditions indicesToSlash = 0

describe("phase0 processSlashings", () => {
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
      minRuns: 5, // Worst case is very slow
      before: () => getProcessSlashingsTestData(indicesToSlashLen),
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => phase0.processSlashings(state as CachedBeaconStatePhase0, epochProcess),
    });
  }
});

/**
 * Create a state that causes `changeRatio` fraction (0,1) of validators to change their effective balance.
 */
function getProcessSlashingsTestData(
  indicesToSlashLen: number
): {
  state: CachedBeaconStateAllForks;
  epochProcess: EpochProcess;
} {
  const state = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
  const epochProcess = beforeProcessEpoch(state);

  epochProcess.indicesToSlash = linspace(indicesToSlashLen);

  return {
    state,
    epochProcess,
  };
}

function linspace(count: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(i);
  return arr;
}
