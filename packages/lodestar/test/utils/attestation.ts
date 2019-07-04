import {
  Attestation,
  AttestationData,
  Epoch,
} from "../../../types";
import {randBetween} from "./misc";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD} from "../../constants";

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
      endEpoch:GENESIS_EPOCH,
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
        shard: GENESIS_START_SHARD,
        startEpoch:GENESIS_EPOCH,
        endEpoch:GENESIS_EPOCH,
        parentRoot:Buffer.alloc(32),
        dataRoot: Buffer.alloc(32),
      }
    },
    custodyBitfield: Buffer.alloc(32),
    signature: Buffer.alloc(96),
  };
}
