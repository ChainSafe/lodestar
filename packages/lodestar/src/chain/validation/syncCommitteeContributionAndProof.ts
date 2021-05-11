import {
  CachedBeaconState,
  isSyncCommitteeAggregator,
  getSyncSubCommitteePubkeys,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {IContributionAndProofJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors/syncCommitteeError";
import {IBeaconChain} from "../interface";
import {
  getSyncCommitteeSelectionProofSignatureSet,
  getContributionAndProofSignatureSet,
  getSyncCommitteeContributionSignatureSet,
} from "./signatureSets";

/**
 * Spec v1.1.0-alpha.3
 */
export async function validateSyncCommitteeGossipContributionAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  contributionAndProofJob: IContributionAndProofJob
): Promise<void> {
  const signedContributionAndProof = contributionAndProofJob.contributionAndProof;
  const contributionAndProof = signedContributionAndProof.message;
  const contribution = contributionAndProof.contribution;
  // [IGNORE] The contribution's slot is for the current slot, i.e. contribution.slot == current_slot.
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

  // [IGNORE] The block being signed over (contribution.beacon_block_root) has been seen (via both gossip and non-gossip sources).
  if (!chain.forkChoice.hasBlock(contribution.beaconBlockRoot)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: contribution.beaconBlockRoot as Uint8Array,
      job: contributionAndProofJob,
    });
  }

  // [REJECT] The subcommittee index is in the allowed range, i.e. contribution.subcommittee_index < SYNC_COMMITTEE_SUBNET_COUNT.
  if (contribution.subCommitteeIndex >= altair.SYNC_COMMITTEE_SUBNET_COUNT) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX,
      subCommitteeIndex: contribution.subCommitteeIndex,
      job: contributionAndProofJob,
    });
  }

  // [IGNORE] The sync committee contribution is the first valid contribution received for the aggregator with index
  // contribution_and_proof.aggregator_index for the slot contribution.slot and subcommittee index contribution.subcommittee_index.
  if (db.seenSyncCommitteeContributionCache.hasContributionAndProof(contributionAndProof)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN,
      job: contributionAndProofJob,
    });
  }

  // [REJECT] contribution_and_proof.selection_proof selects the validator as an aggregator for the slot --
  // i.e. is_sync_committee_aggregator(contribution_and_proof.selection_proof) returns True.
  if (!isSyncCommitteeAggregator(config, contributionAndProof.selectionProof)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_AGGREGATOR,
      aggregatorIndex: contributionAndProof.aggregatorIndex,
      job: contributionAndProofJob,
    });
  }

  // TODO: cache subCommitteeIndices inside CachedBeaconState and do the simple `subCommitteeIndices.includes(aggregatorIndex)` check
  const headState = chain.getHeadState();

  // [REJECT] The aggregator's validator index is in the declared subcommittee of the current sync committee --
  // i.e. state.validators[contribution_and_proof.aggregator_index].pubkey in get_sync_subcommittee_pubkeys(state, contribution.subcommittee_index).
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
    // [REJECT] The contribution_and_proof.selection_proof is a valid signature of the SyncAggregatorSelectionData
    // derived from the contribution by the validator with index contribution_and_proof.aggregator_index.
    getSyncCommitteeSelectionProofSignatureSet(headState, contributionAndProof),

    // [REJECT] The aggregator signature, signed_contribution_and_proof.signature, is valid.
    getContributionAndProofSignatureSet(headState, signedContributionAndProof),

    // [REJECT] The aggregate signature is valid for the message beacon_block_root and aggregate pubkey derived from
    // the participation info in aggregation_bits for the subcommittee specified by the contribution.subcommittee_index.
    getSyncCommitteeContributionSignatureSet(headState, contribution),
  ];

  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
      job: contributionAndProofJob,
    });
  }
  // no need to add to seenSyncCommittteeContributionCache here, gossip handler will do that
}
