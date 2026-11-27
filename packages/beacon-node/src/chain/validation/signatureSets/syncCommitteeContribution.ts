import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeContributionSignatureSet(
  config: BeaconConfig,
  contribution: altair.SyncCommitteeContribution,
  participantIndices: number[]
): ISignatureSet {
  const domain = config.getDomainAtFork(config.getForkName(contribution.slot), DOMAIN_SYNC_COMMITTEE);
  return {
    type: SignatureSetType.aggregate,
    indices: participantIndices,
    signingRoot: computeSigningRoot(ssz.Root, contribution.beaconBlockRoot, domain),
    signature: contribution.signature,
  };
}
