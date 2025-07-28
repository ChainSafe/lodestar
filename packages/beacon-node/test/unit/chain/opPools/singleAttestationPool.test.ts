import {SecretKey} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
import {ForkPostElectra} from "@lodestar/params";
import {EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {CommitteeIndex, Epoch, SingleAttestation, Slot, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {beforeEach, describe, expect, it} from "vitest";
import {
  CommitteeValidatorIndex,
  GetNotSeenValidatorsFn,
  InvalidAttestationData,
  ValidateAttestationDataFn,
} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {SingleAttestationPool} from "../../../../src/chain/opPools/singleAttestationPool.js";

describe("SingleAttestationPool - stored slots", () => {
  const pool = new SingleAttestationPool(null);
  beforeEach(() => {
    for (let slot = 0; slot < 96; slot++) {
      const attestationData = generateAttestationData(slot);
      const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestationData);
      const attestation: SingleAttestation<ForkPostElectra> = {
        committeeIndex: 0,
        attesterIndex: 0,
        data: attestationData,
        signature: Buffer.alloc(96, 0),
      };
      pool.add(attestation.committeeIndex, attestation, toRootHex(dataRoot), 0, 512);
    }
  });

  it("epoch boundary", () => {
    pool.prune(96);
    // pool should store 32 slots
    const storedSlots = Array.from(pool.getStoredSlots()).sort((a, b) => a - b);
    expect(storedSlots.length).toBe(32);
    // store slot from 64 to 95
    for (const [i, slot] of storedSlots.entries()) {
      expect(slot).toBe(64 + i);
    }
  });

  it("last slot of epoch", () => {
    for (let slot = 96; slot < 127; slot++) {
      const attestationData = generateAttestationData(slot);
      const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestationData);
      const attestation: SingleAttestation<ForkPostElectra> = {
        committeeIndex: 0,
        attesterIndex: 0,
        data: attestationData,
        signature: Buffer.alloc(96, 0),
      };
      pool.add(attestation.committeeIndex, attestation, toRootHex(dataRoot), 0, 512);
    }

    pool.prune(127);

    // pool should store 32 slots of prev epoch + 31 slots of current epoch
    const storedSlots = Array.from(pool.getStoredSlots()).sort((a, b) => a - b);
    expect(storedSlots.length).toBe(63);

    // store slot from 64 to 95 and 96 to 126
    for (const [i, slot] of storedSlots.entries()) {
      expect(slot).toBe(64 + i);
    }
  });
});

describe("SingleAttestationPool - seenAggregatedAttestation", () => {
  const pool = new SingleAttestationPool(null);
  const slot = 20252025;
  const attestationData = generateAttestationData(slot);
  const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestationData);
  const attestation: SingleAttestation<ForkPostElectra> = {
    committeeIndex: 0,
    attesterIndex: 0,
    data: attestationData,
    signature: Buffer.alloc(96, 0),
  };
  const seenComitteeValidatorIndex = 3;
  const committeeIndex = 63;
  pool.add(committeeIndex, attestation, toRootHex(dataRoot), seenComitteeValidatorIndex, 512);
  const notSeenCommitteeValidatorIndex = 4;
  pool.add(committeeIndex, attestation, toRootHex(dataRoot), notSeenCommitteeValidatorIndex, 512);

  expect(pool.getAttestationCount()).toBe(2);

  const aggregationBits = BitArray.fromSingleBit(512, seenComitteeValidatorIndex);
  pool.seenAggregatedAttestation(slot, toRootHex(dataRoot), committeeIndex, aggregationBits);

  // the attestation with seenComitteeValidatorIndex should be removed
  expect(pool.getAttestationCount()).toBe(1);

  // it's a little bit tricky because even we add 2 different attestations with different slots, still cannot confirm the stored slots
  // since the method getStoredSlots() returns the slots that are stored in the pool, not the slots of the attestations
});

describe("SingleAttestationPool - getAttestationsForBlockElectraBySlot", () => {
  const pool = new SingleAttestationPool(null);
  const slot = 20252025;
  const stateSlot = slot + 1;
  const committeeIndex = 1;
  const committeeValidatorIndex = 4;

  beforeEach(() => {
    const attestationData = generateAttestationData(slot);
    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestationData);
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    const attestation: SingleAttestation<ForkPostElectra> = {
      committeeIndex,
      attesterIndex: 0,
      data: attestationData,
      signature: sk.sign(ssz.phase0.AttestationData.hashTreeRoot(attestationData)).toBytes(),
    };
    pool.add(committeeIndex, attestation, toRootHex(dataRoot), committeeValidatorIndex, 512);
  });

  it("invalid attestation data", () => {
    const notSeenCommitteeMembersByIndex = new Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>();
    const effectiveBalanceIncrements: EffectiveBalanceIncrements = Uint16Array.from([32]);
    const notSeenValidatorsFn: GetNotSeenValidatorsFn = () => new Set();
    // attestation data is invalid
    const validateAttDataFn: ValidateAttestationDataFn = () => InvalidAttestationData.CannotGetShufflingDependentRoot;
    const consolidations = pool.getAttestationsForBlockElectraBySlot(
      slot,
      stateSlot,
      notSeenCommitteeMembersByIndex,
      effectiveBalanceIncrements,
      notSeenValidatorsFn,
      validateAttDataFn
    );
    expect(consolidations.length).toBe(0);
  });

  it("attestation is seen by notSeenCommitteeMembersByIndex", () => {
    const notSeenCommitteeMembersByIndex = new Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>();
    // this validator is seen after getting through the aggregated attestation pool
    notSeenCommitteeMembersByIndex.set(
      committeeIndex,
      new Set([committeeValidatorIndex + 1, committeeValidatorIndex + 2])
    );
    const effectiveBalanceIncrements: EffectiveBalanceIncrements = Uint16Array.from([32]);
    // this validator is not seen in the state
    const notSeenValidatorsFn: GetNotSeenValidatorsFn = () => new Set();
    // attestation data is valid
    const validateAttDataFn: ValidateAttestationDataFn = () => null;
    const consolidations = pool.getAttestationsForBlockElectraBySlot(
      slot,
      stateSlot,
      notSeenCommitteeMembersByIndex,
      effectiveBalanceIncrements,
      notSeenValidatorsFn,
      validateAttDataFn
    );
    expect(consolidations.length).toBe(0);
  });

  it("attestation is seen by notSeenValidatorsFn", () => {
    const notSeenCommitteeMembersByIndex = new Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>();
    // this validator is not check by the aggregated attestation pool, because maybe 2 aggregated attestation pool does not have this att data
    const effectiveBalanceIncrements: EffectiveBalanceIncrements = Uint16Array.from([32]);
    // this validator is seen in the state
    const notSeenValidatorsFn: GetNotSeenValidatorsFn = () => new Set();
    // attestation data is valid
    const validateAttDataFn: ValidateAttestationDataFn = () => null;
    const consolidations = pool.getAttestationsForBlockElectraBySlot(
      slot,
      stateSlot,
      notSeenCommitteeMembersByIndex,
      effectiveBalanceIncrements,
      notSeenValidatorsFn,
      validateAttDataFn
    );
    expect(consolidations.length).toBe(0);
  });

  it("attestation is included in the block, validator is not seen in notSeenCommitteeMembersByIndex", () => {
    const notSeenCommitteeMembersByIndex = new Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>();
    notSeenCommitteeMembersByIndex.set(committeeIndex, new Set([committeeValidatorIndex]));
    const effectiveBalanceIncrements: EffectiveBalanceIncrements = Uint16Array.from([32]);
    // this function is not called validator is not seen in notSeenCommitteeMembersByIndex
    const notSeenValidatorsFn: GetNotSeenValidatorsFn = () => new Set();
    // attestation data is valid
    const validateAttDataFn: ValidateAttestationDataFn = () => null;
    const consolidations = pool.getAttestationsForBlockElectraBySlot(
      slot,
      stateSlot,
      notSeenCommitteeMembersByIndex,
      effectiveBalanceIncrements,
      notSeenValidatorsFn,
      validateAttDataFn
    );
    expect(consolidations.length).toBe(1);
  });

  it("attestation is included in the block, validator is not seen in BeaconState", () => {
    const notSeenCommitteeMembersByIndex = new Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>();
    // notSeenCommitteeMembersByIndex has no info of committeeValidatorIndex
    const effectiveBalanceIncrements: EffectiveBalanceIncrements = Uint16Array.from([32]);
    // but validator is not seen in the state
    const notSeenValidatorsFn: GetNotSeenValidatorsFn = () => new Set([committeeValidatorIndex]);
    // attestation data is valid
    const validateAttDataFn: ValidateAttestationDataFn = () => null;
    const consolidations = pool.getAttestationsForBlockElectraBySlot(
      slot,
      stateSlot,
      notSeenCommitteeMembersByIndex,
      effectiveBalanceIncrements,
      notSeenValidatorsFn,
      validateAttDataFn
    );
    expect(consolidations.length).toBe(1);
  });

  it("attestation is included in the block, aggregated into single consolidation", () => {
    const attestationData = generateAttestationData(slot);
    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestationData);
    const sk2 = SecretKey.fromBytes(Buffer.alloc(32, 2));
    const committeeIndex2 = committeeIndex + 1;
    const committeeValidatorIndex2 = committeeValidatorIndex + 1;

    const attestation: SingleAttestation<ForkPostElectra> = {
      committeeIndex: committeeIndex2,
      attesterIndex: 1,
      data: attestationData,
      signature: sk2.sign(ssz.phase0.AttestationData.hashTreeRoot(attestationData)).toBytes(),
    };
    pool.add(committeeIndex2, attestation, toRootHex(dataRoot), committeeValidatorIndex2, 512);

    const notSeenCommitteeMembersByIndex = new Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>();
    // notSeenCommitteeMembersByIndex has no info of committeeValidatorIndex
    const effectiveBalanceIncrements: EffectiveBalanceIncrements = Uint16Array.from([32, 2048]);
    // but validator is not seen in the state
    const notSeenValidatorsFn: GetNotSeenValidatorsFn = (__: Epoch, _: Slot, ci: CommitteeIndex) => {
      return ci === committeeIndex
        ? new Set([committeeValidatorIndex])
        : new Set([committeeValidatorIndex2, 100, 101, 102]);
    };
    // attestation data is valid
    const validateAttDataFn: ValidateAttestationDataFn = () => null;
    const consolidations = pool.getAttestationsForBlockElectraBySlot(
      slot,
      stateSlot,
      notSeenCommitteeMembersByIndex,
      effectiveBalanceIncrements,
      notSeenValidatorsFn,
      validateAttDataFn
    );
    expect(consolidations.length).toBe(1);

    const sameAttDataCon = consolidations[0];
    // 2 attesations are consolidated, same slot, different committee index
    expect(Array.from(sameAttDataCon.byCommittee.keys())).toEqual([committeeIndex, committeeIndex2]);
    expect(sameAttDataCon.totalNewSeenEffectiveBalance).toBe(2048 + 32);
    expect(sameAttDataCon.newSeenAttesters).toBe(2);
    expect(sameAttDataCon.notSeenAttesters).toEqual(3);
    expect(sameAttDataCon.totalAttesters).toEqual(512 + 512);
  });
});

function generateAttestationData(slot: Slot): phase0.AttestationData {
  const sourceEpoch = Math.max(0, Math.floor(slot / 32) - 1);
  const targetEpoch = Math.floor(slot / 32);
  return {
    slot: slot,
    index: 0,
    beaconBlockRoot: Buffer.alloc(32),
    source: {epoch: sourceEpoch, root: Buffer.alloc(32)},
    target: {epoch: targetEpoch, root: Buffer.alloc(32)},
  };
}
