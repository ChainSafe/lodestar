import BN from "bn.js";

import {slotToEpoch} from "../../src/chain/helpers/stateTransitionHelpers";
import {Attestation, AttestationData, Slot, Epoch, uint64} from "../../src/types";
import {randBetween} from "./misc";

/**
 * Generates a fake attestation data for test purposes.
 * @param {number} slotValue
 * @param {number} justifiedEpochValue
 * @returns {AttestationData}
 */
export function generateAttestationData(slot: Slot, justifiedEpoch: Epoch): AttestationData {
  return {
    slot,
    shard: randBetween(0, 1024),
    beaconBlockRoot: Buffer.alloc(65),
    epochBoundaryRoot: Buffer.alloc(65),
    shardBlockRoot: Buffer.alloc(65),
    latestCrosslink: {
      epoch: slotToEpoch(slot),
      shardBlockRoot: Buffer.alloc(65),
    },
    justifiedEpoch: justifiedEpoch,
    justifiedBlockRoot: Buffer.alloc(65),
  };
}

export function generateEmptyAttestation(): Attestation {
  return {
    aggregationBitfield: Buffer.alloc(32),
    data: {
      slot: 0,
      shard: 0,
      beaconBlockRoot: Buffer.alloc(32),
      epochBoundaryRoot: Buffer.alloc(32),
      shardBlockRoot: Buffer.alloc(32),
      latestCrosslink: {
        epoch: 0,
        shardBlockRoot: Buffer.alloc(32),
      },
      justifiedEpoch: 0,
      justifiedBlockRoot: Buffer.alloc(32),
    },
    custodyBitfield: Buffer.alloc(32),
    aggregateSignature: Buffer.alloc(96),
  }
}
