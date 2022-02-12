import {List} from "@chainsafe/ssz";
import {CommitteeIndex, Epoch, Slot, phase0} from "@chainsafe/lodestar-types";
import crypto from "node:crypto";
import deepmerge from "deepmerge";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {RecursivePartial} from "@chainsafe/lodestar-utils";

/**
 * Generates a fake attestation data for test purposes.
 * @returns {AttestationData}
 * @param sourceEpoch
 * @param targetEpoch
 * @param index
 * @param slot
 */

export function generateAttestationData(
  sourceEpoch: Epoch,
  targetEpoch: Epoch,
  index: CommitteeIndex = 1,
  slot: Slot = 1
): phase0.AttestationData {
  return {
    slot: slot,
    index: index,
    beaconBlockRoot: crypto.randomBytes(32),
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

export function generateAttestation(override: RecursivePartial<phase0.Attestation> = {}): phase0.Attestation {
  return deepmerge<phase0.Attestation, RecursivePartial<phase0.Attestation>>(
    {
      aggregationBits: Array.from({length: 64}, () => false) as List<boolean>,
      data: {
        slot: 0,
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
    },
    override,
    {isMergeableObject: isPlainObject}
  );
}

export function generateEmptyAttestation(): phase0.Attestation {
  return generateAttestation();
}

export function generateEmptySignedAggregateAndProof(): phase0.SignedAggregateAndProof {
  const message = generateEmptyAggregateAndProof();
  return {
    message,
    signature: Buffer.alloc(96),
  };
}

export function generateEmptyAggregateAndProof(): phase0.AggregateAndProof {
  const attestation = generateEmptyAttestation();
  return {
    aggregatorIndex: 0,
    selectionProof: Buffer.alloc(96),
    aggregate: attestation,
  };
}

export function generateEmptyVoluntaryExit(): phase0.VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
  };
}

export function generateEmptySignedVoluntaryExit(): phase0.SignedVoluntaryExit {
  return {
    message: generateEmptyVoluntaryExit(),
    signature: Buffer.alloc(96),
  };
}
