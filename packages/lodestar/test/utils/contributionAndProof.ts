import {EMPTY_SIGNATURE} from "@chainsafe/lodestar-beacon-state-transition";
import {altair} from "@chainsafe/lodestar-types";
import {isPlainObject, RecursivePartial} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import deepmerge from "deepmerge";

export function generateEmptyContribution(): altair.SyncCommitteeContribution {
  return {
    aggregationBits: Array.from({length: 64}, () => false) as List<boolean>,
    beaconBlockRoot: Buffer.alloc(32),
    signature: Buffer.alloc(96),
    slot: 0,
    subCommitteeIndex: 0,
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
