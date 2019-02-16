import BN from "bn.js";

import {AttestationData, uint64} from "../../types";
import {randBetween} from "./misc";
import {slotToEpoch} from "../../helpers/stateTransitionHelpers";

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
    beaconBlockRoot: Uint8Array.of(65),
    epochBoundaryRoot: Uint8Array.of(65),
    shardBlockRoot: Uint8Array.of(65),
    latestCrosslink: {
      epoch: slotToEpoch(slotValue),
      shardBlockRoot: Uint8Array.of(65),
    },
    justifiedEpoch: justifiedEpochValue,
    justifiedBlockRoot: Uint8Array.of(65),
  };
}
