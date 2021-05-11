import bls, {CoordType} from "@chainsafe/bls";
import {allForks, altair} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {readonlyValues} from "@chainsafe/ssz";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSigningRoot,
  getDomain,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeContributionSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  contribution: altair.SyncCommitteeContribution
): ISignatureSet {
  const {config} = state;
  const {SYNC_COMMITTEE_SIZE} = config.params;
  const subCommitteeSize = intDiv(SYNC_COMMITTEE_SIZE, altair.SYNC_COMMITTEE_SUBNET_COUNT);
  const startIndex = contribution.subCommitteeIndex * subCommitteeSize;
  const aggBits = Array.from(readonlyValues(contribution.aggregationBits));
  const indicesInSyncCommittee: number[] = [];
  for (const [i, bit] of aggBits.entries()) {
    if (bit) indicesInSyncCommittee.push(startIndex + i);
  }
  const syncCommittee = (state as CachedBeaconState<altair.BeaconState>).currentSyncCommittee;
  const blsPubkeys = indicesInSyncCommittee.map((i) => syncCommittee.pubkeys[i]);
  const currentEpoch = computeEpochAtSlot(config, state.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_SYNC_COMMITTEE, currentEpoch);
  return {
    type: SignatureSetType.aggregate,
    // TODO: should index this somewhere?
    pubkeys: blsPubkeys.map((blsPubkey) =>
      bls.PublicKey.fromBytes(blsPubkey.valueOf() as Uint8Array, CoordType.jacobian)
    ),
    signingRoot: computeSigningRoot(config, config.types.phase0.Root, contribution.beaconBlockRoot, domain),
    signature: contribution.signature.valueOf() as Uint8Array,
  };
}
