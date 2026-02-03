import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {CachedBeaconStateAltair, ISignatureSet, SignatureSetType, computeSigningRoot} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeContributionSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAltair,
  contribution: altair.SyncCommitteeContribution,
  participantIndices: number[]
): ISignatureSet {
  const domain = config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE, contribution.slot);
  return {
    type: SignatureSetType.aggregate,
    indices: participantIndices,
    signingRoot: computeSigningRoot(ssz.Root, contribution.beaconBlockRoot, domain),
    signature: contribution.signature,
  };
}
