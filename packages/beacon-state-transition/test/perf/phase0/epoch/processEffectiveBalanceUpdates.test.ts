import {itBench} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {
  allForks,
  beforeProcessEpoch,
  CachedBeaconStateAllForks,
  createCachedBeaconState,
  EpochProcess,
} from "../../../../src";
import {numValidators} from "../../util";
import {StateEpoch} from "../../types";

// PERF: Cost 'proportional' to $VALIDATOR_COUNT, to iterate over all balances. Then cost is proportional to the amount
// of validators whose effectiveBalance changed. Worst case is a massive network leak or a big slashing event which
// causes a large amount of the network to decrease their balance simultaneously.

// Worst case:
// statuses: All balances are low enough to trigger an effective balance change

describe("phase0 processEffectiveBalanceUpdates", () => {
  const vc = numValidators;
  const testCases: {id: string; changeRatio: number}[] = [
    // Normal (optimal) mainnet network conditions: No effectiveBalance is udpated
    {id: "normalcase", changeRatio: 0},
    // Worst case: All effective balance are updated
    // NOTE: The maximum bad case will practically never happen and it's too slow.
    // Use a 50% worst case since it's not that slow.
    {id: "worstcase 0.5", changeRatio: 0.5},
  ];

  // Provide flat `epochProcess.balances` + flat `epochProcess.validators`
  // which will it update validators tree

  for (const {id, changeRatio} of testCases) {
    itBench<StateEpoch, StateEpoch>({
      id: `phase0 processEffectiveBalanceUpdates - ${vc} ${id}`,
      yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
      minRuns: 5, // Worst case is very slow
      before: () => getEffectiveBalanceTestData(vc, changeRatio),
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => allForks.processEffectiveBalanceUpdates(state, epochProcess),
    });
  }
});

/**
 * Create a state that causes `changeRatio` fraction (0,1) of validators to change their effective balance.
 */
function getEffectiveBalanceTestData(
  vc: number,
  changeRatio: number
): {
  state: CachedBeaconStateAllForks;
  epochProcess: EpochProcess;
} {
  const stateTree = ssz.phase0.BeaconState.defaultTreeBacked();
  stateTree.slot = 1;

  const activeValidator = {
    ...ssz.phase0.Validator.defaultTreeBacked(),
    exitEpoch: Infinity,
    withdrawableEpoch: Infinity,
    // Set current effective balance to max
    effectiveBalance: 32e9,
  };

  const balances: number[] = [];
  for (let i = 0; i < vc; i++) {
    // Set flat balance to lower value
    const balance = i < vc * changeRatio ? 30e9 : 32e9;
    stateTree.balances.push(balance);
    balances.push(balance);

    // Initialize tree
    stateTree.validators.push(activeValidator);
  }

  const cachedBeaconState = createCachedBeaconState(config, stateTree, {skipSyncPubkeys: true});
  const epochProcess = beforeProcessEpoch(cachedBeaconState);
  epochProcess.balances = balances;

  return {
    state: cachedBeaconState as CachedBeaconStateAllForks,
    epochProcess: epochProcess,
  };
}
