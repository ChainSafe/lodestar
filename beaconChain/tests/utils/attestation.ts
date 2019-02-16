import BN from "bn.js";

import {slotToEpoch} from "../../helpers/stateTransitionHelpers";
import {AttestationData, uint64} from "../../types";
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
