import {describe, expect, it} from "vitest";
import {ForkSeq} from "@lodestar/params";
import {getExpectedWithdrawals} from "../../../src/block/processWithdrawals.js";
import {numValidators} from "../../perf/util.js";
import {beforeValue} from "../../utils/beforeValue.js";
import {WithdrawalOpts, getExpectedWithdrawalsTestData} from "../../utils/capella.js";

describe("getExpectedWithdrawals", () => {
  const vc = numValidators;

  const testCases: (WithdrawalOpts & {withdrawals: number; sweepCount: number})[] = [
    // Best case when every probe results into a withdrawal candidate
    // Note: sweepCount is +1 compared to old "sampled" since we now count validators processed, not the loop index
    {excessBalance: 1, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, withdrawals: 16, sweepCount: 16},
    // Normal case based on mainnet conditions: mainnet network conditions: 95% reward rate
    {excessBalance: 0.95, eth1Credentials: 0.1, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sweepCount: 220},
    // Intermediate good case
    {excessBalance: 0.95, eth1Credentials: 0.3, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sweepCount: 43},
    {excessBalance: 0.95, eth1Credentials: 0.7, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sweepCount: 19},
    // Intermediate bad case
    {excessBalance: 0.1, eth1Credentials: 0.1, withdrawable: 0, withdrawn: 0, withdrawals: 16, sweepCount: 1021},
    // Expected 141069 but gets bounded by 16384
    {excessBalance: 0.01, eth1Credentials: 0.01, withdrawable: 0, withdrawn: 0, withdrawals: 2, sweepCount: 16384},
    // Expected 250000 but gets bounded by 16384
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, withdrawals: 0, sweepCount: 16384},
  ];

  for (const opts of testCases) {
    const caseID = [
      `eb:${opts.excessBalance}`,
      `eth1:${opts.eth1Credentials}`,
      `we:${opts.withdrawable}`,
      `wn:${opts.withdrawn}`,
    ]
      .filter((str) => str)
      .join(",");

    // Clone true to drop cache
    const state = beforeValue(() => getExpectedWithdrawalsTestData(vc, opts).clone(true));

    // TODO Electra: Add test for electra
    it(`getExpectedWithdrawals ${vc} ${caseID}`, () => {
      const {processedValidatorsSweepCount, withdrawals} = getExpectedWithdrawals(ForkSeq.capella, state.value);
      expect(processedValidatorsSweepCount).toBe(opts.sweepCount);
      expect(withdrawals.length).toBe(opts.withdrawals);
    });
  }
});
