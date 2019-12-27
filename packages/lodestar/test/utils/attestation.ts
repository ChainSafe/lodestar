import {Attestation, AttestationData, CommitteeIndex, Epoch, Slot, VoluntaryExit,} from "@chainsafe/eth2.0-types";
import {BitList} from "@chainsafe/bit-utils";
import crypto from "crypto";
import {AggregateAndProof} from "@chainsafe/eth2.0-types/src";

/**
 * Generates a fake attestation data for test purposes.
 * @returns {AttestationData}
 * @param sourceEpoch
 * @param targetEpoch
 * @param index
 * @param slot
 */

export function generateAttestationData(sourceEpoch: Epoch, targetEpoch: Epoch, index: CommitteeIndex = 1, slot: Slot = 1): AttestationData {
  return {
    slot: slot,
    index: index,
    beaconBlockRoot: crypto.randomBytes(32),
    source: {
      epoch: sourceEpoch,
      root: Buffer.alloc(32),
    },
    target: {
      epoch: targetEpoch,
      root: Buffer.alloc(32),
    },
  };
}

export function generateAttestation(override: Partial<Attestation> = {}): Attestation {
  return {
    aggregationBits: BitList.fromBitfield(Buffer.alloc(8), 64),
    data: {
      slot: 0,
      index: 0,
      beaconBlockRoot: Buffer.alloc(32),
      source: {
        epoch: 0,
        root: Buffer.alloc(32),
      },
      target: {
        epoch: 0,
        root: Buffer.alloc(32),
      },
    },
    signature: Buffer.alloc(96),
    ...override
  };
}

export function generateEmptyAttestation(): Attestation {
  return generateAttestation();
}

export function generateEmptyAggregateAndProof(): AggregateAndProof {
  const attestation = generateEmptyAttestation();
  return {
    aggregatorIndex: 0,
    selectionProof: Buffer.alloc(96),
    aggregate: attestation,
  };
}

export function generateEmptyVoluntaryExit(): VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
    signature: Buffer.alloc(96)
  };
}
