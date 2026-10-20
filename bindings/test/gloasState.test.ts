import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";
import {createGloasState, gloasConfig} from "./gloasFixture.js";
import {createStfState, stfConfig} from "./stfFixture.js";

function createNative(value = createGloasState(), chainConfig = gloasConfig) {
  pubkeyCache.ensureCapacity(value.validators.length);
  const config = new bindings.BeaconConfig(chainConfig, value.genesisValidatorsRoot);
  return bindings.BeaconStateView.createFromBytes(ssz.gloas.BeaconState.serialize(value), config);
}

describe("Gloas native state view", () => {
  it("keeps a Gloas getter and clone alive through reentrant release", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./fixtures/gloasRelease.ts", import.meta.url))],
      {cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 30_000}
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("completed");
  }, 40_000);

  it("preserves progressive state bytes, roots and full-width bid integers", () => {
    const value = createGloasState();
    value.latestBlockHash.fill(7);
    value.executionPayloadAvailability.set(3, true);
    value.payloadExpectedWithdrawals.push({
      ...ssz.capella.Withdrawal.defaultValue(),
      address: new Uint8Array(20).fill(4),
      amount: 5n,
      index: 2,
      validatorIndex: 3,
    });
    const state = createNative(value);
    try {
      expect(state.forkName).toBe("gloas");
      expect(state.isExecutionEnabled(ssz.gloas.BeaconBlock.defaultValue())).toBe(true);
      expect(state.isExecutionStateType).toBe(true);
      expect(state.isMergeTransitionComplete).toBe(true);
      expect(Buffer.compare(state.serialize(), ssz.gloas.BeaconState.serialize(value))).toBe(0);
      expect(state.hashTreeRoot()).toEqual(ssz.gloas.BeaconState.hashTreeRoot(value));
      const materialized = state.toValue();
      expect(materialized.eth1Data.depositCount).toBe(BigInt(value.eth1Data.depositCount));
      // The pinned JS codec represents depositCount as Number.
      materialized.eth1Data.depositCount = value.eth1Data.depositCount;
      expect(Buffer.compare(ssz.gloas.BeaconState.serialize(materialized), state.serialize())).toBe(0);
      expect(state.latestExecutionPayloadBid).toEqual(value.latestExecutionPayloadBid);
      expect(state.latestBlockHash).toEqual(value.latestBlockHash);
      const availability = state.executionPayloadAvailability;
      expect(availability.bitLen).toBe(value.executionPayloadAvailability.bitLen);
      expect(availability.uint8Array).toEqual(value.executionPayloadAvailability.uint8Array);
      expect(state.payloadExpectedWithdrawals).toEqual(value.payloadExpectedWithdrawals);
      availability.uint8Array.fill(0);
      expect(state.executionPayloadAvailability.uint8Array).toEqual(value.executionPayloadAvailability.uint8Array);
      expect(state.getBuilder(0)).toEqual(value.builders[0]);
      expect(state.getBuildersLength()).toBe(1);
      expect(state.canBuilderCoverBid(0, 0)).toBe(true);
      expect(state.builderPendingPayments).toEqual(value.builderPendingPayments);
      expect(state.builderPendingWithdrawals).toEqual([]);
      const cloned = state.processSlots(state.slot, {dontTransferCache: true});
      state.release();
      try {
        expect(cloned.hashTreeRoot()).toEqual(ssz.gloas.BeaconState.hashTreeRoot(value));
      } finally {
        cloned.release();
      }
    } finally {
      state.release();
    }
  });

  it("returns owned separate light-client committee branches on Gloas", () => {
    const value = createGloasState();
    value.nextSyncCommittee.pubkeys.fill(value.validators[1].pubkey);
    const state = createNative(value);
    try {
      const witness = state.getSyncCommitteesWitness();
      expect(witness.witness).toEqual([]);
      expect(witness.currentSyncCommitteeRoot).toEqual(
        ssz.altair.SyncCommittee.hashTreeRoot(value.currentSyncCommittee)
      );
      expect(witness.nextSyncCommitteeRoot).toEqual(ssz.altair.SyncCommittee.hashTreeRoot(value.nextSyncCommittee));
      expect(witness.currentSyncCommitteeBranch).toHaveLength(11);
      expect(witness.nextSyncCommitteeBranch).toHaveLength(11);
      expect(witness.currentSyncCommitteeBranch).toEqual(state.getSingleProof(2945n));
      expect(witness.nextSyncCommitteeBranch).toEqual(state.getSingleProof(2946n));

      const expected = state.getSyncCommitteesWitness();
      witness.currentSyncCommitteeBranch?.[0].fill(0xff);
      witness.nextSyncCommitteeBranch?.[0].fill(0xee);
      expect(state.getSyncCommitteesWitness()).toEqual(expected);
      const detached = state.getSyncCommitteesWitness();
      state.release();
      expect(detached).toEqual(expected);
    } finally {
      state.release();
    }
  });

  it("keeps the legacy shared committee witness on Fulu", () => {
    const value = createStfState();
    value.nextSyncCommittee.pubkeys.fill(value.validators[1].pubkey);
    pubkeyCache.ensureCapacity(value.validators.length);
    const config = new bindings.BeaconConfig(stfConfig, value.genesisValidatorsRoot);
    const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);
    try {
      const witness = state.getSyncCommitteesWitness();
      expect(witness.witness).toHaveLength(5);
      expect(witness.currentSyncCommitteeBranch).toBeUndefined();
      expect(witness.nextSyncCommitteeBranch).toBeUndefined();
      expect([witness.nextSyncCommitteeRoot, ...witness.witness]).toEqual(state.getSingleProof(86n));
      expect([witness.currentSyncCommitteeRoot, ...witness.witness]).toEqual(state.getSingleProof(87n));
    } finally {
      state.release();
    }
  });

  it("returns every PTC position and rejects epochs outside the window", () => {
    const value = createGloasState();
    const state = createNative(value);
    const slotsPerEpoch = value.builderPendingPayments.length / 2;
    try {
      const expected = value.ptcWindow[slotsPerEpoch + (value.slot % slotsPerEpoch)];
      expect(Array.from(state.getPayloadTimelinessCommittee(state.slot))).toEqual(expected);
      expect(state.getIndicesInPayloadTimelinessCommittee(0, state.slot)).toEqual(
        expected.flatMap((index, position) => (index === 0 ? [position] : []))
      );
      expect(state.getIndicesInPayloadTimelinessCommittee(15, state.slot)).toEqual([]);
      expect(state.getEpochPTCs(state.epoch).map((committee) => Array.from(committee))).toEqual(
        value.ptcWindow.slice(slotsPerEpoch, slotsPerEpoch * 2)
      );
      expect(() => state.getPayloadTimelinessCommittee(state.slot - slotsPerEpoch * 2)).toThrow("EpochOutOfRange");
      expect(() => state.getEpochPTCs(state.epoch - 1)).toThrow("EpochOutOfRange");
      expect(() => state.getBuilder(-1)).toThrow("InvalidBuilderIndex");
      expect(() => state.canBuilderCoverBid(0, Number.MAX_SAFE_INTEGER + 1)).toThrow("InvalidBidAmount");
    } finally {
      state.release();
    }
  });

  it("rejects the previous epoch's PTC at the Gloas boundary", () => {
    const value = createGloasState();
    const slotsPerEpoch = value.builderPendingPayments.length / 2;
    value.slot = 3 * slotsPerEpoch;
    const state = createNative(value, {...gloasConfig, GLOAS_FORK_EPOCH: 3});
    try {
      expect(() => state.getPayloadTimelinessCommittee(value.slot - 1)).toThrow("EpochBeforeGloas");
      expect(() => state.getIndicesInPayloadTimelinessCommittee(0, value.slot - 1)).toThrow("EpochBeforeGloas");
      expect(state.getPayloadTimelinessCommittee(value.slot)).toBeInstanceOf(Uint32Array);
    } finally {
      state.release();
    }
  });

  it.each([
    1n << 63n,
    (1n << 64n) - 2n,
  ])("converts a full-width builder balance %s without a signed cast trap", (balance) => {
    const value = createGloasState();
    const bytes = ssz.gloas.BeaconState.serialize(value);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stateRanges = ssz.gloas.BeaconState.getFieldRanges(data, 0, bytes.length);
    const builders = stateRanges[Object.keys(ssz.gloas.BeaconState.fields).indexOf("builders")];
    const builderRanges = ssz.gloas.Builder.getFieldRanges(
      data,
      builders.start,
      builders.start + ssz.gloas.Builder.fixedSize
    );
    data.setBigUint64(
      builders.start + builderRanges[Object.keys(ssz.gloas.Builder.fields).indexOf("balance")].start,
      balance,
      true
    );
    pubkeyCache.ensureCapacity(value.validators.length);
    const config = new bindings.BeaconConfig(gloasConfig, value.genesisValidatorsRoot);
    const state = bindings.BeaconStateView.createFromBytes(bytes, config);
    try {
      expect(state.getBuilder(0).balance).toBe(Number(balance));
    } finally {
      state.release();
    }
  });

  it("rejects an oversized PTC member without aborting the process", () => {
    const value = createGloasState();
    const slotsPerEpoch = value.builderPendingPayments.length / 2;
    value.ptcWindow[slotsPerEpoch + (value.slot % slotsPerEpoch)][0] = 2 ** 32;
    const state = createNative(value);
    try {
      expect(() => state.getPayloadTimelinessCommittee(state.slot)).toThrow("IntegerOutOfRange");
      expect(() => state.getEpochPTCs(state.epoch)).toThrow("IntegerOutOfRange");
      expect(state.slot).toBe(value.slot);
    } finally {
      state.release();
    }
  });

  it("applies parent effects to an owned clone and keeps its source unchanged on success or failure", () => {
    const value = createGloasState();
    const slotsPerEpoch = value.builderPendingPayments.length / 2;
    const paymentIndex = slotsPerEpoch + (value.latestBlockHeader.slot % slotsPerEpoch);
    value.builderPendingPayments[paymentIndex].withdrawal.amount = 11;
    const state = createNative(value);
    const originalRoot = state.hashTreeRoot();
    const requests = ssz.gloas.ExecutionRequests.defaultValue();
    const deposit = ssz.gloas.BuilderDepositRequest.defaultValue();
    deposit.pubkey = value.builders[0].pubkey;
    deposit.withdrawalCredentials[0] = 0xb0;
    deposit.amount = 7;
    requests.builderDeposits.push(deposit);
    try {
      expect(() => state.withParentPayloadApplied(new Uint8Array([1]))).toThrow();
      expect(state.hashTreeRoot()).toEqual(originalRoot);
      const post = state.withParentPayloadApplied(ssz.gloas.ExecutionRequests.serialize(requests));
      try {
        expect(state.hashTreeRoot()).toEqual(originalRoot);
        const expected = ssz.gloas.BeaconState.deserialize(ssz.gloas.BeaconState.serialize(value));
        expected.builders[0].balance += deposit.amount;
        expected.builderPendingWithdrawals.push(expected.builderPendingPayments[paymentIndex].withdrawal);
        expected.builderPendingPayments[paymentIndex] = ssz.gloas.BuilderPendingPayment.defaultValue();
        expected.executionPayloadAvailability.set(
          value.latestBlockHeader.slot % expected.executionPayloadAvailability.bitLen,
          true
        );
        expected.latestBlockHash = expected.latestExecutionPayloadBid.blockHash;
        expect(Buffer.compare(post.serialize(), ssz.gloas.BeaconState.serialize(expected))).toBe(0);
        expect(post.hashTreeRoot()).toEqual(ssz.gloas.BeaconState.hashTreeRoot(expected));
        expect(post.getExpectedWithdrawals().processedBuilderWithdrawalsCount).toBe(1);
        expect(post.getExpectedWithdrawals().expectedWithdrawals[0].amount).toBe(11n);
        state.release();
        expect(post.getBuilder(0).balance).toBe(value.builders[0].balance + 7);
      } finally {
        post.release();
      }
    } finally {
      state.release();
    }
  });
});
