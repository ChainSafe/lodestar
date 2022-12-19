import {itBench} from "@dapplion/benchmark";
import {CachedBeaconStateCapella} from "../../../src/index.js";
import {getExpectedWithdrawals} from "../../../src/block/processWithdrawals.js";
import {numValidators} from "../util.js";
import {getExpectedWithdrawalsTestData, WithdrawalOpts} from "../../utils/capella.js";

// PERF: Fixed cost for MAX_WITHDRAWALS_PER_PAYLOAD probes
//  + cost 'proportional' to $VALIDATOR_COUNT with balances under MAX_EFFECTIVE_BALANCE or
//    having BLS withdrawal credential prefix as that validator probe is wasted.
//
// Best case:
//  All Validator have balances > MAX_EFFECTIVE_BALANCE and ETH1 withdrawal credential prefix set
//
// Worst case:
//  All balances are low enough or withdrawal credential not set

describe("getExpectedWithdrawals", () => {
  const vc = numValidators;
  // lowBalanceRatio  represents ratio of validators with low balance
  // blsCredentialRatio represents ratio of validators not eligible for withdrawals which
  // can approximate these two cases in combined manner:
  //  - because of credentials not enabled
  //  - or they were full withdrawan and zero balance
  const testCases: (WithdrawalOpts & {cache: boolean; sampled: number})[] = [
    // Best case when every probe results into a withdrawal candidate
    {excessBalance: 1, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, cache: true, sampled: 15},
    // Normal case based on mainnet conditions: mainnet network conditions: 95% reward rate
    {excessBalance: 0.95, eth1Credentials: 0.1, withdrawable: 0.05, withdrawn: 0, cache: true, sampled: 219},
    // Intermediate good case
    {excessBalance: 0.95, eth1Credentials: 0.3, withdrawable: 0.05, withdrawn: 0, cache: true, sampled: 42},
    {excessBalance: 0.95, eth1Credentials: 0.7, withdrawable: 0.05, withdrawn: 0, cache: true, sampled: 18},
    // Intermediate bad case
    {excessBalance: 0.1, eth1Credentials: 0.1, withdrawable: 0, withdrawn: 0, cache: true, sampled: 1_020},
    {excessBalance: 0.03, eth1Credentials: 0.03, withdrawable: 0, withdrawn: 0, cache: true, sampled: 11_777},
    // Expected 141_069 but gets bounded at 16_384
    {excessBalance: 0.01, eth1Credentials: 0.01, withdrawable: 0, withdrawn: 0, cache: true, sampled: 16_384},
    // Worst case: All validators 250_000 need to be probed but get bounded at 16_384
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, cache: true, sampled: 16_384},
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, cache: false, sampled: 16_384},
    {excessBalance: 0, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, cache: true, sampled: 16_384},
    {excessBalance: 0, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, cache: false, sampled: 16_384},
  ];

  for (const opts of testCases) {
    const caseID = [
      `eb ${opts.excessBalance}`,
      `eth1 ${opts.eth1Credentials}`,
      `we ${opts.withdrawable}`,
      `wn ${opts.withdrawn}`,
      opts.cache ? null : "nocache",
      `- smpl ${opts.sampled}`,
    ]
      .filter((str) => str)
      .join(" ");

    itBench<CachedBeaconStateCapella, CachedBeaconStateCapella>({
      id: `vc - ${vc} ${caseID}`,
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
        const {sampledValidators} = getExpectedWithdrawals(state);
        if (sampledValidators !== opts.sampled) {
          throw Error(`Wrong sampledValidators ${sampledValidators} != ${opts.sampled}`);
        }
      },
    });
  }
});
