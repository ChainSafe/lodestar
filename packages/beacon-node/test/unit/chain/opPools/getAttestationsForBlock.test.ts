import {BitArray, fromHexString} from "@chainsafe/ssz";
import {ForkName, ForkPostElectra} from "@lodestar/params";
import {Attestation, CommitteeIndex, Slot, phase0, ssz} from "@lodestar/types";
import {beforeEach, describe, expect, it} from "vitest";
import {
  AttestationNonParticipant,
  AttestationsConsolidation,
} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {getAttestationsForBlock} from "../../../../src/chain/opPools/getAttestationsForBlock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedElectraState} from "../../../utils/state.js";

describe("getAttestationsForBlock", () => {
  let chain: MockedBeaconChain;
  const state = generateCachedElectraState({slot: 20252025});

  beforeEach(() => {
    chain = getMockedBeaconChain();
  });

  it("should produce packed attestations from both pools", () => {
    const storedSlots = [
      state.slot - 1,
      state.slot - 2,
      state.slot - 3,
      state.slot - 4,
      state.slot - 5,
      state.slot - 6,
    ];
    chain.aggregatedAttestationPool.getStoredSlots.mockReturnValue(storedSlots);

    const aggAttestationPoolResult = {
      consolidations: storedSlots.map((slot) => generateAAConsolidation(slot)),
      notSeenCommitteeMembersByIndex: new Map<number, Set<number>>(),
    };
    chain.aggregatedAttestationPool.getAttestationsForBlockElectraBySlot.mockReturnValue(aggAttestationPoolResult);

    // only the most recent 3 slots has missing committee members' attestations
    chain.singleAttestationPool.getStoredSlots.mockReturnValue(new Set(storedSlots.slice(0, 3)));
    const singleAttestationPoolResult = storedSlots.slice(0, 3).map((slot) => generateSAConsolidation(slot));
    chain.singleAttestationPool.getAttestationsForBlockElectraBySlot.mockReturnValue(singleAttestationPoolResult);

    const packedAttestations = getAttestationsForBlock.call(chain, ForkName.electra, state);
    expect(packedAttestations.length).toBe(8);

    // order of attestations: 6 from aggregated attestation pool, 2 from single attestation pool
    // the last 1 attestation from SingleAttestationPool of state.slot - 3 is not included

    // confirm committeeBits are full for all packed attestations from aggregated attestation pool
    for (const [i, packedAttestation] of packedAttestations.slice(0, storedSlots.length).entries()) {
      expect((packedAttestation as Attestation<ForkPostElectra>).committeeBits.getTrueBitIndexes().length).toBe(
        committeeCount
      );
      // 1 committee has 1 non-participant
      expect(packedAttestation.aggregationBits.getTrueBitIndexes().length).toBe(
        committeeCount * (committeeSize - nonParticipationPerCommittee)
      );
      expect(packedAttestation.data.slot).toBe(storedSlots[i]);
    }

    // aggregatedAttestationPool returns 3 attestations for slot state.slot - 1, state.slot - 2, state.slot - 3
    // but only the first 2 are included due to the limit of 8 packed attestations
    for (const [i, packedAttestation] of packedAttestations.slice(packedAttestations.length - 2).entries()) {
      expect((packedAttestation as Attestation<ForkPostElectra>).committeeBits.getTrueBitIndexes().length).toBe(
        committeeCount
      );
      // 1 committee has 1 non-participant
      expect(packedAttestation.aggregationBits.getTrueBitIndexes().length).toBe(
        committeeCount * nonParticipationPerCommittee
      );
      // attestations are ordered by score, however all attestations have the same total effective balance
      // hence only slot distance matters
      expect(packedAttestation.data.slot).toBe(storedSlots[i]);
    }
  });
});

/** Valid signature of random data to prevent BLS errors */
const validSignature = fromHexString(
  "0xb2afb700f6c561ce5e1b4fedaec9d7c06b822d38c720cf588adfda748860a940adf51634b6788f298c552de40183b5a203b2bbe8b7dd147f0bb5bc97080a12efbb631c8888cb31a99cc4706eb3711865b8ea818c10126e4d818b542e9dbf9ae8"
);

const committeeCount = 64;
const committeeSize = 32;
const nonParticipationPerCommittee = 1; // assuming 1 non-participant per committee for simplicity

/**
 * generate AttestationsConsolidation for aggregated attestation pool
 */
function generateAAConsolidation(slot: Slot): AttestationsConsolidation {
  const byCommittee = generateAANonParticipationByCommittee(slot);
  return {
    byCommittee,
    attData: generateAttestationData(slot),
    totalNewSeenEffectiveBalance: 32 * (committeeSize - nonParticipationPerCommittee) * committeeCount,
    newSeenAttesters: (committeeSize - nonParticipationPerCommittee) * committeeCount,
    notSeenAttesters: nonParticipationPerCommittee * committeeCount,
    totalAttesters: committeeSize * committeeCount,
  };
}

/**
 * generate AttestationsConsolidation for SingleAttestationPool
 */
function generateSAConsolidation(slot: Slot): AttestationsConsolidation {
  const byCommittee = generateSANonParticipationByCommittee(slot);
  return {
    byCommittee,
    attData: generateAttestationData(slot),
    totalNewSeenEffectiveBalance: 32 * nonParticipationPerCommittee * committeeCount,
    newSeenAttesters: nonParticipationPerCommittee * committeeCount,
    notSeenAttesters: 0, // all committee members are seen
    totalAttesters: committeeSize * committeeCount,
  };
}

/**
 * generate a map of AttestationNonParticipant for each committee in the aggregated attestation pool
 */
function generateAANonParticipationByCommittee(slot: Slot): Map<CommitteeIndex, AttestationNonParticipant> {
  const result = new Map<CommitteeIndex, AttestationNonParticipant>();
  for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
    result.set(committeeIndex, generateAAAttestationNonParticipant(slot, committeeIndex));
  }
  return result;
}

/**
 * generate a map of AttestationNonParticipant for each committee in the SingleAttestationPool
 */
function generateSANonParticipationByCommittee(slot: Slot): Map<CommitteeIndex, AttestationNonParticipant> {
  const result = new Map<CommitteeIndex, AttestationNonParticipant>();
  for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
    result.set(committeeIndex, generateSAAttestationNonParticipant(slot, committeeIndex));
  }
  return result;
}

// generate AttestationNonParticipant for aggregated attestation pool
function generateAAAttestationNonParticipant(slot: Slot, committeeIndex: CommitteeIndex): AttestationNonParticipant {
  return {
    attestation: generateAAAttestation(slot, committeeIndex),
    newSeenEffectiveBalance: 32 * (committeeSize - nonParticipationPerCommittee),
    newSeenAttesters: committeeSize - nonParticipationPerCommittee,
    // the last committee member is not seen
    notSeenCommitteeMembers: new Set([committeeSize - 1]),
  };
}

/**
 * generate AttestationNonParticipant for SingleAttestationPool
 */
function generateSAAttestationNonParticipant(slot: Slot, committeeIndex: CommitteeIndex): AttestationNonParticipant {
  return {
    attestation: generateSAAttestation(slot, committeeIndex),
    newSeenEffectiveBalance: 32 * nonParticipationPerCommittee,
    newSeenAttesters: nonParticipationPerCommittee,
    notSeenCommitteeMembers: new Set(),
  };
}

/**
 * generate attestations for aggregated attestation pool
 * assume last ${nonParticipationPerCommittee} committee members are not seen
 */
function generateAAAttestation(slot: Slot, committeeIndex: CommitteeIndex): Attestation<ForkPostElectra> {
  const committeeBits = ssz.electra.CommitteeBits.defaultValue();
  committeeBits.set(committeeIndex, true);
  const aggregationBits = BitArray.fromBitLen(committeeSize);
  for (let i = 0; i < committeeSize - nonParticipationPerCommittee; i++) {
    aggregationBits.set(i, true);
  }

  return {
    aggregationBits,
    data: generateAttestationData(slot),
    signature: validSignature,
    committeeBits,
  };
}

/**
 * generate attestations for SingleAttestationPool
 * assuming the last ${nonParticipationPerCommittee} committee members are seen
 */
function generateSAAttestation(slot: Slot, committeeIndex: CommitteeIndex): Attestation<ForkPostElectra> {
  const committeeBits = ssz.electra.CommitteeBits.defaultValue();
  committeeBits.set(committeeIndex, true);
  const aggregationBits = BitArray.fromBitLen(committeeSize);
  for (let i = committeeSize - nonParticipationPerCommittee; i < committeeSize; i++) {
    aggregationBits.set(i, true);
  }
  return {
    aggregationBits,
    data: generateAttestationData(slot),
    signature: validSignature,
    committeeBits,
  };
}

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
