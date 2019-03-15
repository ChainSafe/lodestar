import BN from "bn.js";

import {slotToEpoch} from "../../src/chain/helpers/stateTransitionHelpers";
import {Attestation, AttestationData, uint64} from "../../src/types";
import {randBetween} from "./misc";

/**
 * Generates a fake attestation data for test purposes.
 * @param {number} slotValue
 * @param {number} justifiedEpochValue
 * @returns {AttestationData}
 */
export function generateAttestationData(slotValue: uint64, justifiedEpochValue: uint64): AttestationData {
  return {
    slot: slotValue,
    shard: new BN(randBetween(0, 1024)),
    beaconBlockRoot: Buffer.alloc(65),
    epochBoundaryRoot: Buffer.alloc(65),
    shardBlockRoot: Buffer.alloc(65),
    latestCrosslink: {
      epoch: slotToEpoch(slotValue),
      shardBlockRoot: Buffer.alloc(65),
    },
    justifiedEpoch: justifiedEpochValue,
    justifiedBlockRoot: Buffer.alloc(65),
  };
}

export function generateEmptyAttestation(): Attestation {
  return {
    aggregationBitfield: Buffer.alloc(32),
    data: {
      slot: new BN(0),
      shard: new BN(0),
      beaconBlockRoot: Buffer.alloc(32),
      epochBoundaryRoot: Buffer.alloc(32),
      shardBlockRoot: Buffer.alloc(32),
      latestCrosslink: {
        epoch: new BN(0),
        shardBlockRoot: Buffer.alloc(32),
      },
      justifiedEpoch: new BN(0),
      justifiedBlockRoot: Buffer.alloc(32),
    },
    custodyBitfield: Buffer.alloc(32),
    aggregateSignature: Buffer.alloc(96),
  }
}
