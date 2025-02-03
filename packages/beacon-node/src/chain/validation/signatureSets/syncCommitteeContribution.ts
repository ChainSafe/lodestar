import {PublicKey} from "@chainsafe/blst";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {CachedBeaconStateAltair, ISignatureSet, SignatureSetType, computeSigningRoot} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeContributionSignatureSet(
  state: CachedBeaconStateAltair,
  contribution: altair.SyncCommitteeContribution,
  pubkeys: PublicKey[]
): ISignatureSet {
  const domain = state.config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE, contribution.slot);
  return {
    type: SignatureSetType.aggregate,
    pubkeys,
    signingRoot: computeSigningRoot(ssz.Root, contribution.beaconBlockRoot, domain),
    signature: contribution.signature,
  };
}
