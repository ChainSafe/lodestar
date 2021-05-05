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
} from "../..";

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  syncCommittee: altair.SyncCommitteeSignature
): ISignatureSet {
  const {config, epochCtx} = state;
  const currentEpoch = computeEpochAtSlot(config, state.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_SYNC_COMMITTEE, currentEpoch);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(config, config.types.phase0.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature.valueOf() as Uint8Array,
  };
}

export function getSubCommitteeSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  contributionAndProof: altair.ContributionAndProof
): ISignatureSet {
  const {config, epochCtx} = state;
  const slot = contributionAndProof.contribution.slot;
  const epoch = computeEpochAtSlot(config, slot);
  const domain = getDomain(config, state, config.params.DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, epoch);
  const signingData: altair.SyncCommitteeSigningData = {
    slot,
    subCommitteeIndex: contributionAndProof.contribution.subCommitteeIndex,
  };
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[contributionAndProof.aggregatorIndex],
    signingRoot: computeSigningRoot(config, config.types.altair.SyncCommitteeSigningData, signingData, domain),
    signature: contributionAndProof.selectionProof.valueOf() as Uint8Array,
  };
}

export function getSignedContributionAndProofSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  signedContributionAndProof: altair.SignedContributionAndProof
): ISignatureSet {
  const {config, epochCtx} = state;
  const slot = signedContributionAndProof.message.contribution.slot;
  const epoch = computeEpochAtSlot(config, slot);
  const domain = getDomain(config, state, config.params.DOMAIN_CONTRIBUTION_AND_PROOF, epoch);
  const signingData = signedContributionAndProof.message;
  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedContributionAndProof.message.aggregatorIndex],
    signingRoot: computeSigningRoot(config, config.types.altair.ContributionAndProof, signingData, domain),
    signature: signedContributionAndProof.signature.valueOf() as Uint8Array,
  };
}

export function getContributionSignatureSet(
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
