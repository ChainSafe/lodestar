import {
  CachedBeaconState,
  isSyncCommitteeAggregator,
  getSyncSubCommitteePubkeys,
} from "@chainsafe/lodestar-beacon-state-transition";
import {fast} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {IContributionAndProofJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors/syncCommitteeError";
import {IBeaconChain} from "../interface";

export async function validateGossipContributionAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  contributionAndProofJob: IContributionAndProofJob
): Promise<void> {
  const signedContributionAndProof = contributionAndProofJob.contributionAndProof;
  const contributionAndProof = signedContributionAndProof.message;
  const contribution = contributionAndProof.contribution;
  // The contribution's slot is for the current slot
  if (chain.clock.currentSlot < contribution.slot) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.FUTURE_SLOT,
      currentSlot: chain.clock.currentSlot,
      syncCommitteeSlot: contribution.slot,
      job: contributionAndProofJob,
    });
  }

  if (chain.clock.currentSlot > contribution.slot) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.PAST_SLOT,
      currentSlot: chain.clock.currentSlot,
      syncCommitteeSlot: contribution.slot,
      job: contributionAndProofJob,
    });
  }

  // The block being signed over has not been seen
  if (!chain.forkChoice.hasBlock(contribution.beaconBlockRoot)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: contribution.beaconBlockRoot as Uint8Array,
      job: contributionAndProofJob,
    });
  }

  if (contribution.subCommitteeIndex >= altair.SYNC_COMMITTEE_SUBNET_COUNT) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX,
      subCommitteeIndex: contribution.subCommitteeIndex,
      job: contributionAndProofJob,
    });
  }

  if (db.seenSyncCommitteeContributionCache.hasContributionAndProof(contributionAndProof)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN,
      job: contributionAndProofJob,
    });
  }
  // check the validator is aggregator for the slot
  if (!isSyncCommitteeAggregator(config, contributionAndProof.selectionProof)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_AGGREGATOR,
      aggregatorIndex: contributionAndProof.aggregatorIndex,
      job: contributionAndProofJob,
    });
  }

  // TODO: cache subCommitteeIndices inside CachedBeaconState and do the simple `subCommitteeIndices.includes(aggregatorIndex)` check
  const headState = chain.getHeadState();
  const aggregatorPubkey = headState.validators[contributionAndProof.aggregatorIndex].pubkey;
  if (
    !getSyncSubCommitteePubkeys(
      config,
      headState as CachedBeaconState<altair.BeaconState>,
      contribution.subCommitteeIndex
    ).includes(aggregatorPubkey)
  ) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.AGGREGATOR_PUBKEY_UNKNOWN,
      aggregatorIndex: contributionAndProof.aggregatorIndex,
      job: contributionAndProofJob,
    });
  }

  const signatureSets = [
    // validate selection_proof
    fast.getSubCommitteeSignatureSet(headState, contributionAndProof),
    // validate signature of SignedContributionAndProof
    fast.getSignedContributionAndProofSignatureSet(headState, signedContributionAndProof),
    // validate aggregated signature
    fast.getContributionSignatureSet(headState, contribution),
  ];

  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
      job: contributionAndProofJob,
    });
  }
  // no need to add to seenSyncCommittteeContributionCache here, gossip handler will do that
}
