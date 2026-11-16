import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, ForkSeq, PAYLOAD_BUILDER_VERSION, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getExpectedWithdrawals, processWithdrawals} from "../../../src/block/processWithdrawals.js";
import {createCachedBeaconState} from "../../../src/index.js";
import {numValidators} from "../../../src/testUtils/util.js";
import {CachedBeaconStateGloas} from "../../../src/types.js";
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

describe("getExpectedWithdrawals builder sweep", () => {
  it("sweeps the balance left after the builder's pending withdrawal in the same payload", () => {
    const config = getConfig(ForkName.gloas);
    const view = ssz.gloas.BeaconState.defaultViewDU();
    view.slot = 2 * SLOTS_PER_EPOCH;
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: config.GENESIS_FORK_VERSION,
      currentVersion: config.GLOAS_FORK_VERSION,
      epoch: 0,
    });
    view.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey: Buffer.alloc(48, 1),
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress: Buffer.alloc(20, 2),
        balance: 5_000_000_000,
        depositEpoch: 0,
        withdrawableEpoch: 2,
      })
    );
    view.builderPendingWithdrawals.push(
      ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        feeRecipient: Buffer.alloc(20, 5),
        amount: 1_000_000_000,
        builderIndex: 0,
      })
    );
    view.commit();
    const state = createCachedBeaconState(
      view,
      {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
      {skipSyncCommitteeCache: true}
    ) as CachedBeaconStateGloas;

    const {expectedWithdrawals} = getExpectedWithdrawals(ForkSeq.gloas, state);

    expect(expectedWithdrawals.map((withdrawal) => withdrawal.amount)).toEqual([1_000_000_000n, 4_000_000_000n]);
  });
});

describe("processWithdrawals parent payload status", () => {
  const pendingAmount = 1_000_000_000;

  /** State with a builder pending withdrawal, whose latest bid committed to `bid` */
  function buildState(
    latest: {blockHash: Uint8Array; payloadRoot: Uint8Array},
    bid: {blockHash: Uint8Array; payloadRoot: Uint8Array}
  ): CachedBeaconStateGloas {
    const config = getConfig(ForkName.gloas);
    const view = ssz.gloas.BeaconState.defaultViewDU();
    view.slot = 2 * SLOTS_PER_EPOCH;
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: config.GENESIS_FORK_VERSION,
      currentVersion: config.GLOAS_FORK_VERSION,
      epoch: 0,
    });
    view.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey: Buffer.alloc(48, 1),
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress: Buffer.alloc(20, 2),
        balance: 5 * pendingAmount,
        depositEpoch: 0,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    view.builderPendingWithdrawals.push(
      ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        feeRecipient: Buffer.alloc(20, 5),
        amount: pendingAmount,
        builderIndex: 0,
      })
    );
    view.latestBlockHash = latest.blockHash;
    view.latestPayloadRoot = latest.payloadRoot;
    view.latestExecutionPayloadBid = ssz.gloas.ExecutionPayloadBid.toViewDU({
      ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
      blockHash: bid.blockHash,
      payloadRoot: bid.payloadRoot,
    });
    view.commit();
    return createCachedBeaconState(
      view,
      {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
      {skipSyncCommitteeCache: true}
    ) as CachedBeaconStateGloas;
  }

  it("returns early if the latest payload root is not the one of the latest bid, even if the block hashes match", () => {
    const blockHash = Buffer.alloc(32, 3);
    const state = buildState(
      {blockHash, payloadRoot: Buffer.alloc(32, 6)},
      {blockHash, payloadRoot: Buffer.alloc(32, 7)}
    );

    processWithdrawals(ForkSeq.gloas, state);

    expect(state.builderPendingWithdrawals.length).toBe(1);
    expect(state.builders.getReadonly(0).balance).toBe(5 * pendingAmount);
    expect(state.payloadExpectedWithdrawals.length).toBe(0);
  });

  it("processes withdrawals if the latest payload root is the one of the latest bid, even if the block hashes differ", () => {
    const payloadRoot = Buffer.alloc(32, 6);
    const state = buildState(
      {blockHash: Buffer.alloc(32, 3), payloadRoot},
      {blockHash: Buffer.alloc(32, 4), payloadRoot}
    );

    processWithdrawals(ForkSeq.gloas, state);

    expect(state.builderPendingWithdrawals.length).toBe(0);
    expect(state.builders.getReadonly(0).balance).toBe(4 * pendingAmount);
    expect(state.payloadExpectedWithdrawals.length).toBe(1);
  });
});
