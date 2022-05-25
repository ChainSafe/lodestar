import type {PublicKey} from "@chainsafe/bls/types";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {DOMAIN_SYNC_COMMITTEE} from "@chainsafe/lodestar-params";
import {
  CachedBeaconStateAltair,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeContributionSignatureSet(
  state: CachedBeaconStateAltair,
  contribution: altair.SyncCommitteeContribution,
  pubkeys: PublicKey[]
): ISignatureSet {
  const domain = state.config.getDomain(DOMAIN_SYNC_COMMITTEE, contribution.slot);
  return {
    type: SignatureSetType.aggregate,
    pubkeys,
    signingRoot: computeSigningRoot(ssz.Root, contribution.beaconBlockRoot, domain),
    signature: contribution.signature,
  };
}
