import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks} from "../../../../src";
import {createCachedBeaconState} from "../../../../src/allForks";
import {numValidators} from "../../util";
import {StateEpoch} from "../../types";

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
  setBenchOpts({maxMs: 60 * 1000, minRuns: 5});

  const vc = numValidators;
  const testCases: {id: string; lengths: IndicesLengths}[] = [
    // Normal (optimal) mainnet network conditions: No effectiveBalance is udpated
    {
      id: "normalcase",
      lengths: {
        indicesToEject: 0,
        indicesEligibleForActivationQueue: 0,
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

  // Provide flat `epochProcess.balances` + flat `epochProcess.validators`
  // which will it update validators tree

  for (const {id, lengths} of testCases) {
    itBench<StateEpoch, StateEpoch>({
      id: `phase0 processRegistryUpdates - ${vc} ${id}`,
      before: () => getRegistryUpdatesTestData(vc, lengths),
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => allForks.processRegistryUpdates(state, epochProcess),
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
  vc: number,
  lengths: IndicesLengths
): {
  state: allForks.CachedBeaconState<allForks.BeaconState>;
  epochProcess: allForks.IEpochProcess;
} {
  const stateTree = ssz.phase0.BeaconState.defaultTreeBacked();
  stateTree.slot = 1;

  const activeValidator = {
    ...ssz.phase0.Validator.defaultTreeBacked(),
    exitEpoch: Infinity,
    withdrawableEpoch: Infinity,
    // Set current effective balance to max
    effectiveBalance: BigInt(32e9),
  };

  // Initialize tree
  for (let i = 0; i < vc; i++) {
    stateTree.validators.push(activeValidator);
  }

  const cachedBeaconState = createCachedBeaconState(config, stateTree, {skipSyncPubkeys: true});
  const epochProcess: Partial<allForks.IEpochProcess> = {
    indicesToEject: linspace(lengths.indicesToEject),
    indicesEligibleForActivationQueue: linspace(lengths.indicesEligibleForActivationQueue),
    indicesEligibleForActivation: linspace(lengths.indicesEligibleForActivation),
  };

  return {
    state: cachedBeaconState as allForks.CachedBeaconState<allForks.BeaconState>,
    epochProcess: epochProcess as allForks.IEpochProcess,
  };
}

function linspace(count: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(i);
  return arr;
}
