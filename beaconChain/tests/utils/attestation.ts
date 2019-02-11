import BN from "bn.js";

import {randBetween} from "./misc";
import {AttestationData} from "../../types";

/**
 * Generates a fake attestation data for test purposes.
 * @param {number} slotValue
 * @param {number} justifiedEpochValue
 * @returns {AttestationData}
 */
export function generateAttestationData(slotValue: number | BN, justifiedEpochValue: number | BN): AttestationData {
  return {
    slot: new BN(slotValue),
    shard: new BN(randBetween(0, 1024)),
    beaconBlockRoot: Uint8Array.of(65),
    epochBoundaryRoot: Uint8Array.of(65),
    shardBlockRoot: Uint8Array.of(65),
    latestCrosslinkRoot: Uint8Array.of(65),
    justifiedEpoch: new BN(justifiedEpochValue),
    justifiedBlockRoot: Uint8Array.of(65),
  };
}
