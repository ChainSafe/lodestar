import {EMPTY_SIGNATURE} from "@chainsafe/lodestar-beacon-state-transition";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@chainsafe/lodestar-params";
import {altair} from "@chainsafe/lodestar-types";
import {isPlainObject, RecursivePartial} from "@chainsafe/lodestar-utils";
import {fromHexString, List} from "@chainsafe/ssz";
import deepmerge from "deepmerge";

export function generateEmptyContribution(): altair.SyncCommitteeContribution {
  return {
    aggregationBits: Array.from({length: SYNC_COMMITTEE_SUBNET_SIZE}, () => false) as List<boolean>,
    beaconBlockRoot: Buffer.alloc(32),
    signature: fromHexString(
      "99cb82bc69b4111d1a828963f0316ec9aa38c4e9e041a8afec86cd20dfe9a590999845bf01d4689f3bbe3df54e48695e081f1216027b577c7fccf6ab0a4fcc75faf8009c6b55e518478139f604f542d138ae3bc34bad01ee6002006d64c4ff82"
    ),
    slot: 0,
    subcommitteeIndex: 0,
  };
}

export function generateContributionAndProof(
  override: RecursivePartial<altair.ContributionAndProof> = {}
): altair.ContributionAndProof {
  return deepmerge<altair.ContributionAndProof, RecursivePartial<altair.ContributionAndProof>>(
    {
      aggregatorIndex: 0,
      contribution: generateEmptyContribution(),
      selectionProof: EMPTY_SIGNATURE,
    },
    override,
    {isMergeableObject: isPlainObject}
  );
}

export function generateSignedContributionAndProof(
  override: RecursivePartial<altair.ContributionAndProof> = {}
): altair.SignedContributionAndProof {
  return {
    message: generateContributionAndProof(override),
    signature: EMPTY_SIGNATURE,
  };
}
