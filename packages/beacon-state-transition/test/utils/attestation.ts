import {List} from "@chainsafe/ssz";
import {phase0, Epoch, Slot} from "@chainsafe/lodestar-types";

/**
 * Generates a fake attestation data for test purposes.
 * @returns {AttestationData}
 * @param sourceEpoch
 * @param targetEpoch
 * @param slot
 */

export function generateAttestationData(
  sourceEpoch: Epoch,
  targetEpoch: Epoch,
  slot: Slot = 0
): phase0.AttestationData {
  return {
    slot: slot,
    index: 0,
    beaconBlockRoot: Buffer.alloc(32),
    source: {
      epoch: sourceEpoch,
      root: Buffer.alloc(32),
    },
    target: {
      epoch: targetEpoch,
      root: Buffer.alloc(32),
    },
  };
}

export function generateEmptyAttestation(): phase0.Attestation {
  return {
    aggregationBits: Array.from({length: 64}, () => false) as List<boolean>,
    data: {
      slot: 1,
      index: 0,
      beaconBlockRoot: Buffer.alloc(32),
      source: {
        epoch: 0,
        root: Buffer.alloc(32),
      },
      target: {
        epoch: 0,
        root: Buffer.alloc(32),
      },
    },
    signature: Buffer.alloc(96),
  };
}
