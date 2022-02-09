import {PublicKey} from "@chainsafe/bls";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {DOMAIN_SYNC_COMMITTEE, SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {readonlyValues} from "@chainsafe/ssz";
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
    signature: contribution.signature.valueOf() as Uint8Array,
  };
}

/**
 * Retrieve pubkeys in contribution aggregate using epochCtx:
 * - currSyncCommitteeIndexes cache
 * - index2pubkey cache
 */
export function getContributionPubkeys(
  state: CachedBeaconStateAltair,
  contribution: altair.SyncCommitteeContribution
): PublicKey[] {
  const pubkeys: PublicKey[] = [];

  const subcommitteeSize = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const startIndex = contribution.subcommitteeIndex * subcommitteeSize;
  const aggBits = Array.from(readonlyValues(contribution.aggregationBits));
  const syncCommittee = state.epochCtx.getIndexedSyncCommittee(contribution.slot);
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
