import {bench, describe} from "@chainsafe/benchmark";
import {ForkSeq} from "@lodestar/params";
import {getExpectedWithdrawals} from "../../../src/block/processWithdrawals.js";
import {CachedBeaconStateCapella} from "../../../src/index.js";
import {WithdrawalOpts, getExpectedWithdrawalsTestData} from "../../utils/capella.js";
import {numValidators} from "../util.js";

// PERF: Fixed cost for MAX_WITHDRAWALS_PER_PAYLOAD probes
//  + cost 'proportional' to $VALIDATOR_COUNT with balances under MAX_EFFECTIVE_BALANCE or
//    having BLS withdrawal credential prefix as that validator probe is wasted.
//
// Best case:
//  All Validator have balances > MAX_EFFECTIVE_BALANCE and ETH1 withdrawal credential prefix set // TODO Electra: Not true anymore
//
// Worst case:
//  All balances are low enough or withdrawal credential not set

describe("getExpectedWithdrawals", () => {
  const vc = numValidators;
  // lowBalanceRatio  represents ratio of validators with low balance
  // blsCredentialRatio represents ratio of validators not eligible for withdrawals which
  // can approximate these two cases in combined manner:
  //  - because of credentials not enabled
  //  - or they were full withdrawn and zero balance
  // Note: sweepCount is +1 compared to old "sampled" since we now count validators processed, not the loop index
  const testCases: (WithdrawalOpts & {cache: boolean; sweepCount: number})[] = [
    // Best case when every probe results into a withdrawal candidate
    {excessBalance: 1, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, cache: true, sweepCount: 16},
    // Normal case based on mainnet conditions: mainnet network conditions: 95% reward rate
    {excessBalance: 0.95, eth1Credentials: 0.1, withdrawable: 0.05, withdrawn: 0, cache: true, sweepCount: 220},
    // Intermediate good case
    {excessBalance: 0.95, eth1Credentials: 0.3, withdrawable: 0.05, withdrawn: 0, cache: true, sweepCount: 43},
    {excessBalance: 0.95, eth1Credentials: 0.7, withdrawable: 0.05, withdrawn: 0, cache: true, sweepCount: 19},
    // Intermediate bad case
    {excessBalance: 0.1, eth1Credentials: 0.1, withdrawable: 0, withdrawn: 0, cache: true, sweepCount: 1_021},
    {excessBalance: 0.03, eth1Credentials: 0.03, withdrawable: 0, withdrawn: 0, cache: true, sweepCount: 11_778},
    // Expected 141_069 but gets bounded at 16_384
    {excessBalance: 0.01, eth1Credentials: 0.01, withdrawable: 0, withdrawn: 0, cache: true, sweepCount: 16_384},
    // Worst case: All validators 250_000 need to be probed but get bounded at 16_384
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, cache: true, sweepCount: 16_384},
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, cache: false, sweepCount: 16_384},
    {excessBalance: 0, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, cache: true, sweepCount: 16_384},
    {excessBalance: 0, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, cache: false, sweepCount: 16_384},
  ];

  for (const opts of testCases) {
    const caseID = [
      `eb:${opts.excessBalance}`,
      `eth1:${opts.eth1Credentials}`,
      `we:${opts.withdrawable}`,
      `wn:${opts.withdrawn}`,
      opts.cache ? null : "nocache",
      `swp:${opts.sweepCount}`,
    ]
      .filter((str) => str)
      .join(",");

    bench<CachedBeaconStateCapella, CachedBeaconStateCapella>({
      id: `getExpectedWithdrawals ${vc} ${caseID}`,
      yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
      before: () => {
        const state = getExpectedWithdrawalsTestData(vc, opts);
        if (opts.cache) {
          state.balances.getAll();
          state.validators.getAllReadonly();
        }
        return state;
      },
      beforeEach: (state) => {
        // clone with true to drop cache
        return opts.cache ? state : state.clone(true);
      },
      fn: (state) => {
        const {processedValidatorsSweepCount} = getExpectedWithdrawals(ForkSeq.capella, state); // TODO Electra: Do test for electra
        if (processedValidatorsSweepCount !== opts.sweepCount) {
          throw Error(`Wrong processedValidatorsSweepCount ${processedValidatorsSweepCount} != ${opts.sweepCount}`);
        }
      },
    });
  }
});
