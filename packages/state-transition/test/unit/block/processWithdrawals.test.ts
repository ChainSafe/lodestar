import {expect} from "chai";
import {getExpectedWithdrawals} from "../../../src/block/processWithdrawals.js";
import {numValidators} from "../../perf/util.js";
import {getExpectedWithdrawalsTestData, WithdrawalOpts} from "../../utils/capella.js";
import {beforeValue} from "../../utils/beforeValue.js";

describe("getExpectedWithdrawals", () => {
  const vc = numValidators;

  const testCases: (WithdrawalOpts & {withdrawals: number; sampled: number})[] = [
    // Best case when every probe results into a withdrawal candidate
    {excessBalance: 1, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, withdrawals: 16, sampled: 15},
    // Normal case based on mainnet conditions: mainnet network conditions: 95% reward rate
    {excessBalance: 0.95, eth1Credentials: 0.1, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sampled: 219},
    // Intermediate good case
    {excessBalance: 0.95, eth1Credentials: 0.3, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sampled: 42},
    {excessBalance: 0.95, eth1Credentials: 0.7, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sampled: 18},
    // Intermediate bad case
    {excessBalance: 0.1, eth1Credentials: 0.1, withdrawable: 0, withdrawn: 0, withdrawals: 16, sampled: 1020},
    // Expected 141069 but gets bounded by 16384
    {excessBalance: 0.01, eth1Credentials: 0.01, withdrawable: 0, withdrawn: 0, withdrawals: 2, sampled: 16384},
    // Expected 250000 but gets bounded by 16384
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, withdrawals: 0, sampled: 16384},
  ];

  for (const opts of testCases) {
    const caseID = [
      `eb ${opts.excessBalance}`,
      `eth1 ${opts.eth1Credentials}`,
      `we ${opts.withdrawable}`,
      `wn ${opts.withdrawn}`,
    ]
      .filter((str) => str)
      .join(" ");

    // Clone true to drop cache
    const state = beforeValue(() => getExpectedWithdrawalsTestData(vc, opts).clone(true));

    it(`vc - ${vc} ${caseID}`, () => {
      const {sampledValidators, withdrawals} = getExpectedWithdrawals(state.value);
      expect(sampledValidators).equals(opts.sampled, "Wrong sampledValidators");
      expect(withdrawals.length).equals(opts.withdrawals, "Wrong withdrawals");
    });
  }
});
