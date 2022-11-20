import {itBench} from "@dapplion/benchmark";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {BLS_WITHDRAWAL_PREFIX, ETH1_ADDRESS_WITHDRAWAL_PREFIX} from "@lodestar/params";

import {CachedBeaconStateCapella} from "../../../src/index.js";
import {getExpectedWithdrawals} from "../../../src/block/processWithdrawals.js";
import {numValidators} from "../util.js";
import {createCachedBeaconStateTest} from "../../utils/state.js";

// PERF: Fixed cost for MAX_WITHDRAWALS_PER_PAYLOAD probes
//  + cost 'proportional' to $VALIDATOR_COUNT with balances under MAX_EFFECTIVE_BALANCE or
//    having BLS withdrawal credential prefix as that validator probe is wasted.
//
// Best case:
//  All Validator have balances > MAX_EFFECTIVE_BALANCE and ETH1 withdrawal credential prefix set
//
// Worst case:
//  All balances are low enough or withdrawal credential not set

describe("capella getExpectedWithdrawals", () => {
  const vc = numValidators;
  const testCases: {id: string; lowBalanceRatio: number; blsCredentialRatio: number}[] = [
    // Best case when every probe results into a withdrawal candidate
    {id: "bestcase", lowBalanceRatio: 0, blsCredentialRatio: 0},
    // Normal case based on mainnet conditions: mainnet network conditions: 95% reward rate
    {id: "normalcase - 100% withdrawals enabled", lowBalanceRatio: 0.05, blsCredentialRatio: 0},
    {id: "normalcase - 70% withdrawals enabled", lowBalanceRatio: 0.05, blsCredentialRatio: 0.3},
    {id: "normalcase - 40% withdrawals enabled", lowBalanceRatio: 0.05, blsCredentialRatio: 0.6},
    {id: "normalcase - 10% withdrawals enabled", lowBalanceRatio: 0.05, blsCredentialRatio: 0.9},
    // Degraded case
    {id: "slighly degraded case - 90% withdrawals enabled", lowBalanceRatio: 0.1, blsCredentialRatio: 0.1},
    {id: "degraded case - 90% withdrawals enabled", lowBalanceRatio: 0.3, blsCredentialRatio: 0.1},
    {id: "highly degraded case - 90% withdrawals enabled", lowBalanceRatio: 0.4, blsCredentialRatio: 0.1},
    // Worst case: All effective balance are updated
    // NOTE: The maximum bad case will practically never happen and it's too slow.
    // Use a 50% worst case since it's not that slow.
    {id: "worstcase - lowBalance ", lowBalanceRatio: 1, blsCredentialRatio: 0},
    {id: "worstcase - no withdrawals enabled ", lowBalanceRatio: 0, blsCredentialRatio: 1},
  ];

  // Provide flat `epochProcess.balances` + flat `epochProcess.validators`
  // which will it update validators tree

  for (const {id, lowBalanceRatio, blsCredentialRatio} of testCases) {
    itBench<{state: CachedBeaconStateCapella}, {state: CachedBeaconStateCapella}>({
      id: `capella getExpectedWithdrawals - ${vc} ${id}`,
      yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
      minRuns: 5, // Worst case is very slow
      before: () => getExpectedWithdrawalsTestData(vc, lowBalanceRatio, blsCredentialRatio),
      beforeEach: ({state}) => ({state: state.clone()}),
      fn: ({state}) => {
        getExpectedWithdrawals(state);
      },
    });
  }
});

/**
 * Create a state that has `lowBalanceRatio` fraction (0,1) of validators with balance < max effective
 * balance and `blsCredentialRatio` fraction (0,1) of withdrawal credentials not set for withdrawals
 */
function getExpectedWithdrawalsTestData(
  vc: number,
  lowBalanceRatio: number,
  blsCredentialRatio: number
): {
  state: CachedBeaconStateCapella;
} {
  const stateTree = ssz.capella.BeaconState.defaultViewDU();
  stateTree.slot = 1;

  const activeValidator = ssz.phase0.Validator.toViewDU({
    ...ssz.phase0.Validator.defaultValue(),
    exitEpoch: Infinity,
    withdrawableEpoch: Infinity,
    // Set current effective balance to max
    effectiveBalance: 32e9,
  });

  const balances: number[] = [];
  for (let i = 0; i < vc; i++) {
    // Set flat balance to lower value
    const balance = i < vc * lowBalanceRatio ? 30e9 : 32e9;
    stateTree.balances.push(balance);
    balances.push(balance);

    const credentialPrefix = i < vc * blsCredentialRatio ? BLS_WITHDRAWAL_PREFIX : ETH1_ADDRESS_WITHDRAWAL_PREFIX;
    activeValidator.withdrawalCredentials[0] = credentialPrefix;

    // Initialize tree
    stateTree.validators.push(activeValidator);
  }

  stateTree.commit();

  const cachedBeaconState = createCachedBeaconStateTest(stateTree, config, {skipSyncPubkeys: true});
  return {
    state: cachedBeaconState,
  };
}
