import {PublicKey} from "@chainsafe/bls";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {DOMAIN_SYNC_COMMITTEE, SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {readonlyValues} from "@chainsafe/ssz";
import {
  CachedBeaconState,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeContributionSignatureSet(
  state: CachedBeaconState<altair.BeaconState>,
  contribution: altair.SyncCommitteeContribution,
  pubkeys: PublicKey[]
): ISignatureSet {
  const domain = state.config.getDomain(DOMAIN_SYNC_COMMITTEE, contribution.slot);
  return {
    type: SignatureSetType.aggregate,
    pubkeys,
    signingRoot: computeSigningRoot(ssz.Root, contribution.beaconBlockRoot, domain),
    signature: contribution.signature.valueOf() as Uint8Array,
  };
}

/**
 * Retrieve pubkeys in contribution aggregate using epochCtx:
 * - currSyncCommitteeIndexes cache
 * - index2pubkey cache
 */
export function getContributionPubkeys(
  state: CachedBeaconState<altair.BeaconState>,
  contribution: altair.SyncCommitteeContribution
): PublicKey[] {
  const pubkeys: PublicKey[] = [];

  const subCommitteeSize = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const startIndex = contribution.subCommitteeIndex * subCommitteeSize;
  const aggBits = Array.from(readonlyValues(contribution.aggregationBits));
  const syncCommittee = allForks.getIndexedSyncCommittee(state, contribution.slot);
  for (const [i, bit] of aggBits.entries()) {
    if (bit) {
      const indexInCommittee = startIndex + i;
      const validatorIndex = syncCommittee.validatorIndices[indexInCommittee];
      const pubkey = state.index2pubkey[validatorIndex];
      pubkeys.push(pubkey);
    }
  }

  return pubkeys;
}
