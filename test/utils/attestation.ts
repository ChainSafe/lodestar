import {
  Attestation,
  AttestationData,
  bytes32,
  Crosslink,
  Epoch,
  IndexedAttestation,
  PendingAttestation
} from "../../src/types";
import {randBetween} from "./misc";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH} from "../../src/constants";

/**
 * Generates a fake attestation data for test purposes.
 * @param {number} slotValue
 * @param {number} justifiedEpochValue
 * @returns {AttestationData}
 */

export function generateAttestationData(sourceEpoch: Epoch, targetEpoch: Epoch): AttestationData {
  return {
    beaconBlockRoot: Buffer.alloc(32),
    sourceEpoch: sourceEpoch,
    targetEpoch: targetEpoch,
    sourceRoot: Buffer.alloc(32),
    targetRoot: Buffer.alloc(32),
    crosslink: {
      shard: randBetween(0, 1024),
      startEpoch:GENESIS_EPOCH,
      endEpoch:FAR_FUTURE_EPOCH,
      parentRoot:Buffer.alloc(32),
      dataRoot: Buffer.alloc(32),
    }
    ,
  };
}

export function generateEmptyAttestation(): Attestation {
  return {
    aggregationBitfield: Buffer.alloc(32),
    data: {
      beaconBlockRoot: Buffer.alloc(32),
      sourceEpoch: 0,
      targetEpoch: 0,
      sourceRoot: Buffer.alloc(32),
      targetRoot: Buffer.alloc(32),
      crosslink: {
        shard: randBetween(0, 1024),
        startEpoch:GENESIS_EPOCH,
        endEpoch:FAR_FUTURE_EPOCH,
        parentRoot:Buffer.alloc(32),
        dataRoot: Buffer.alloc(32),
      }
    },
    custodyBitfield: Buffer.alloc(32),
    signature: Buffer.alloc(96),
  };
}

export function pendingAttestationFromYaml(value: any): PendingAttestation {
  return {
    aggregationBitfield: Buffer.from(value.aggregationBitfield.slice(2), 'hex'),
    data: attestationDataFromYaml(value.data),
    inclusionDelay: value.inclusionDelay.toNumber(),
    proposerIndex: value.proposerIndex.toNumber()
  };
}


export function attestationFromYaml(value: any): Attestation {
  return {
    aggregationBitfield: Buffer.from(value.aggregationBitfield.slice(2), 'hex'),
    signature: Buffer.from(value.signature.slice(2), 'hex'),
    custodyBitfield: Buffer.from(value.custodyBitfield.slice(2), 'hex'),
    data: attestationDataFromYaml(value.data)
  };
}

export function indexedAttestationFromYaml(value: any): IndexedAttestation {
  return {
    custodyBit0Indices: value.custodyBit0Indices.map((value) => value.toNumber()),
    custodyBit1Indices: value.custodyBit1Indices.map((value) => value.toNumber()),
    data: attestationDataFromYaml(value.data),
    signature: Buffer.from(value.signature.slice(2), 'hex')
  };
}

export function attestationDataFromYaml(value: any): AttestationData {
  return {
    beaconBlockRoot: Buffer.from(value.beaconBlockRoot.slice(2), 'hex'),
    sourceEpoch: value.sourceEpoch.toNumber(),
    sourceRoot: Buffer.from(value.sourceRoot.slice(2), 'hex'),
    targetEpoch: value.targetEpoch.toNumber(),
    targetRoot: Buffer.from(value.targetRoot.slice(2), 'hex'),
    crosslink: {
      shard: value.crosslink.shard.toNumber(),
      startEpoch: value.crosslink.startEpoch.toNumber(),
      endEpoch: value.crosslink.endEpoch.toNumber(),
      parentRoot:Buffer.from(value.crosslink.parentRoot.slice(2), 'hex'),
      dataRoot: Buffer.from(value.crosslink.parentRoot.slice(2), 'hex'),
    },
  };
}
