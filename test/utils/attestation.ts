import {Attestation, AttestationData, Epoch, PendingAttestation} from "../../src/types";
import {randBetween} from "./misc";

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
    shard: randBetween(0, 1024),
    previousCrosslinkRoot: Buffer.alloc(32),
    crosslinkDataRoot: Buffer.alloc(32),
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
      shard: randBetween(0, 1024),
      previousCrosslinkRoot: Buffer.alloc(32),
      crosslinkDataRoot: Buffer.alloc(32),
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

export function attestationDataFromYaml(value: any): AttestationData {
  return {
    targetEpoch: value.targetEpoch.toNumber(),
    beaconBlockRoot: Buffer.from(value.beaconBlockRoot.slice(2), 'hex'),
    targetRoot: Buffer.from(value.targetRoot.slice(2), 'hex'),
    sourceEpoch: value.sourceEpoch.toNumber(),
    previousCrosslinkRoot: Buffer.from(value.previousCrosslinkRoot.slice(2), 'hex'),
    sourceRoot: Buffer.from(value.sourceRoot.slice(2), 'hex'),
    shard: value.shard.toNumber(),
    crosslinkDataRoot: Buffer.from(value.crosslinkDataRoot.slice(2), 'hex')
  };
}
