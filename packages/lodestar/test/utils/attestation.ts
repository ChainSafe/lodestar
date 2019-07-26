import {
  Attestation,
  AttestationData,
  Epoch,
} from "../../src/types";
import {randBetween} from "./misc";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD} from "../../src/constants";
import { BitList } from "@chainsafe/bit-utils";

/**
 * Generates a fake attestation data for test purposes.
 * @param {number} slotValue
 * @param {number} justifiedEpochValue
 * @returns {AttestationData}
 */

export function generateAttestationData(sourceEpoch: Epoch, targetEpoch: Epoch): AttestationData {
  return {
    beaconBlockRoot: Buffer.alloc(32),
    source: {
      epoch: sourceEpoch,
      root: Buffer.alloc(32),
    },
    target: {
      epoch: targetEpoch,
      root: Buffer.alloc(32),
    },
    crosslink: {
      shard: randBetween(0, 1024),
      startEpoch:GENESIS_EPOCH,
      endEpoch:GENESIS_EPOCH,
      parentRoot:Buffer.alloc(32),
      dataRoot: Buffer.alloc(32),
    },
  };
}

export function generateEmptyAttestation(): Attestation {
  return {
    aggregationBits: BitList.fromBitfield(Buffer.alloc(8), 64),
    custodyBits: BitList.fromBitfield(Buffer.alloc(8), 64),
    data: {
      beaconBlockRoot: Buffer.alloc(32),
      source: {
        epoch: 0,
        root: Buffer.alloc(32),
      },
      target: {
        epoch: 0,
        root: Buffer.alloc(32),
      },
      crosslink: {
        shard: GENESIS_START_SHARD,
        startEpoch:GENESIS_EPOCH,
        endEpoch:GENESIS_EPOCH,
        parentRoot:Buffer.alloc(32),
        dataRoot: Buffer.alloc(32),
      }
    },
    signature: Buffer.alloc(96),
  };
}
