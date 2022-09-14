import {fromHex} from "@lodestar/utils";
import {altair, phase0} from "@lodestar/types";
import {BitArray} from "@chainsafe/ssz";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";

export function generateAttestation(): phase0.Attestation {
  return {
    aggregationBits: BitArray.fromBitLen(64),
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
  };
}

export function generateEmptyAggregateAndProof(): phase0.AggregateAndProof {
  return {
    aggregatorIndex: 0,
    selectionProof: Buffer.alloc(96),
    aggregate: generateAttestation(),
  };
}

export function generateEmptyContribution(): altair.SyncCommitteeContribution {
  return {
    aggregationBits: BitArray.fromBitLen(SYNC_COMMITTEE_SUBNET_SIZE),
    beaconBlockRoot: Buffer.alloc(32),
    signature: fromHex(
      "99cb82bc69b4111d1a828963f0316ec9aa38c4e9e041a8afec86cd20dfe9a590999845bf01d4689f3bbe3df54e48695e081f1216027b577c7fccf6ab0a4fcc75faf8009c6b55e518478139f604f542d138ae3bc34bad01ee6002006d64c4ff82"
    ),
    slot: 0,
    subcommitteeIndex: 0,
  };
}

export function generateContributionAndProof(): altair.ContributionAndProof {
  return {
    aggregatorIndex: 0,
    contribution: generateEmptyContribution(),
    selectionProof: Buffer.alloc(96),
  };
}
