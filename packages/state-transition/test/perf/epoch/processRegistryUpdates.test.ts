import {itBench} from "@dapplion/benchmark";
import {ForkSeq} from "@lodestar/params";
import {beforeProcessEpoch, CachedBeaconStateAllForks, EpochTransitionCache} from "../../../src/index.js";
import {processRegistryUpdates} from "../../../src/epoch/processRegistryUpdates.js";
import {generatePerfTestCachedStatePhase0, numValidators} from "../util.js";
import {StateEpoch} from "../types.js";

// PERF: Cost 'proportional' to only validators that active + exit. For mainnet conditions:
// - indicesEligibleForActivationQueue: Maxing deposits triggers 512 validator mutations
// - indicesEligibleForActivation: 4 per epoch
// - indicesToEject: Potentially the entire validator set. On a massive offline event this could trigger many mutations
//   per epoch. Note that once mutated that validator can't be added to indicesToEject.
//
// - On normal mainnet conditions only 4 validators will be updated
//   - indicesEligibleForActivation: ~4000
//   - indicesEligibleForActivationQueue: 0
//   - indicesToEject: 0

describe("phase0 processRegistryUpdates", () => {
  const vc = numValidators;
  const testCases: {id: string; notTrack?: boolean; lengths: IndicesLengths}[] = [
    // Normal (optimal) mainnet network conditions: No effectiveBalance is udpated
    {
      id: "normalcase",
      notTrack: true,
      lengths: {
        indicesToEject: 0,
        indicesEligibleForActivationQueue: 0,
        indicesEligibleForActivation: 4000,
      },
    },
    // All blocks in epoch full of deposits
    {
      id: "badcase_full_deposits",
      lengths: {
        indicesToEject: 0,
        indicesEligibleForActivationQueue: 512,
        indicesEligibleForActivation: 4000,
      },
    },
    // Worst case: All effective balance are updated
    {
      id: "worstcase 0.5",
      lengths: {
        indicesToEject: Math.floor(vc / 2),
        indicesEligibleForActivationQueue: 512,
        indicesEligibleForActivation: 4000,
      },
    },
  ];

  // Provide flat `cache.balances` + flat `cache.validators`
  // which will it update validators tree

  for (const {id, notTrack, lengths} of testCases) {
    itBench<StateEpoch, StateEpoch>({
      id: `phase0 processRegistryUpdates - ${vc} ${id}`,
      // WeakRef keeps a strong reference to its constructor value until the event loop ticks.
      // Without this `sleep(0)` all the SubTree(s) created updating the validators registry
      // won't be garabage collected causing an OOM crash. Tracking issue https://github.com/nodejs/node/issues/39902
      yieldEventLoopAfterEach: true,
      minRuns: 5, // Worst case is very slow
      noThreshold: notTrack,
      before: () => getRegistryUpdatesTestData(vc, lengths),
      beforeEach: async ({state, cache}) => ({state: state.clone(), cache}),
      fn: ({state, cache}) => processRegistryUpdates(ForkSeq.phase0, state, cache),
    });
  }
});

type IndicesLengths = {
  indicesToEject: number;
  indicesEligibleForActivationQueue: number;
  indicesEligibleForActivation: number;
};

/**
 * Create a state that causes `changeRatio` fraction (0,1) of validators to change their effective balance.
 */
function getRegistryUpdatesTestData(
  _vc: number,
  lengths: IndicesLengths
): {
  state: CachedBeaconStateAllForks;
  cache: EpochTransitionCache;
} {
  const state = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
  const cache = beforeProcessEpoch(state);

  cache.indicesToEject = linspace(lengths.indicesToEject);
  cache.indicesEligibleForActivationQueue = linspace(lengths.indicesEligibleForActivationQueue);
  cache.indicesEligibleForActivation = linspace(lengths.indicesEligibleForActivation);

  return {
    state,
    cache,
  };
}

function linspace(count: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(i);
  return arr;
}
