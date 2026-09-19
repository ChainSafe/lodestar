import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, ForkSeq, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getExpectedWithdrawals} from "../../../src/block/processWithdrawals.js";
import {createCachedBeaconState} from "../../../src/index.js";
import {numValidators} from "../../../src/testUtils/util.js";
import {beforeValue} from "../../utils/beforeValue.js";
import {WithdrawalOpts, getExpectedWithdrawalsTestData} from "../../utils/capella.js";

describe("getExpectedWithdrawals", () => {
  const vc = numValidators;

  const testCases: (WithdrawalOpts & {withdrawals: number; sampled: number})[] = [
    // Best case when every probe results into a withdrawal candidate
    {excessBalance: 1, eth1Credentials: 1, withdrawable: 0, withdrawn: 0, withdrawals: 16, sampled: 16},
    // Normal case based on mainnet conditions: mainnet network conditions: 95% reward rate
    {excessBalance: 0.95, eth1Credentials: 0.1, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sampled: 220},
    // Intermediate good case
    {excessBalance: 0.95, eth1Credentials: 0.3, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sampled: 43},
    {excessBalance: 0.95, eth1Credentials: 0.7, withdrawable: 0.05, withdrawn: 0, withdrawals: 16, sampled: 19},
    // Intermediate bad case
    {excessBalance: 0.1, eth1Credentials: 0.1, withdrawable: 0, withdrawn: 0, withdrawals: 16, sampled: 1021},
    // Expected 141069 but gets bounded by 16384
    {excessBalance: 0.01, eth1Credentials: 0.01, withdrawable: 0, withdrawn: 0, withdrawals: 2, sampled: 16384},
    // Expected 250000 but gets bounded by 16384
    {excessBalance: 0, eth1Credentials: 0.0, withdrawable: 0, withdrawn: 0, withdrawals: 0, sampled: 16384},
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
      const {processedValidatorSweepCount, expectedWithdrawals} = getExpectedWithdrawals(ForkSeq.capella, state.value);
      expect(processedValidatorSweepCount).toBe(opts.sampled);
      expect(expectedWithdrawals.length).toBe(opts.withdrawals);
    });
  }
});

describe("getExpectedWithdrawals gloas", () => {
  it("sweeps the full builder balance regardless of its pending withdrawals", () => {
    const config = getConfig(ForkName.gloas);
    const view = ssz.gloas.BeaconState.defaultViewDU();
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: config.GENESIS_FORK_VERSION,
      currentVersion: config.GLOAS_FORK_VERSION,
      epoch: 0,
    });
    const state = createCachedBeaconState(
      view,
      {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
      {skipSyncCommitteeCache: true}
    );

    const builderBalance = 32_000_000_000;
    const pendingAmount = 1_000_000_000;
    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey: new Uint8Array(48).fill(1),
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress: new Uint8Array(20).fill(1),
        balance: builderBalance,
        depositEpoch: 0,
        withdrawableEpoch: 0,
      })
    );
    state.builderPendingWithdrawals.push(
      ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        feeRecipient: new Uint8Array(20).fill(2),
        amount: pendingAmount,
        builderIndex: 0,
      })
    );

    const {expectedWithdrawals} = getExpectedWithdrawals(ForkSeq.gloas, state);

    expect(expectedWithdrawals.map((withdrawal) => withdrawal.amount)).toEqual([
      BigInt(pendingAmount),
      BigInt(builderBalance),
    ]);
  });
});
