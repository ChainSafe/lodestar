import {Attestation, AttestationData, Epoch} from "../../src/types";
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
