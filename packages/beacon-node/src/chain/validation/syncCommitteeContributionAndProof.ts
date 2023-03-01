import {CachedBeaconStateAltair, isSyncCommitteeAggregator} from "@lodestar/state-transition";
import {altair, ValidatorIndex} from "@lodestar/types";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {GossipAction, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";
import {validateGossipSyncCommitteeExceptSig} from "./syncCommittee.js";
import {
  getSyncCommitteeSelectionProofSignatureSet,
  getContributionAndProofSignatureSet,
  getSyncCommitteeContributionSignatureSet,
} from "./signatureSets/index.js";

/**
 * Spec v1.1.0-beta.2
 */
export async function validateSyncCommitteeGossipContributionAndProof(
  chain: IBeaconChain,
  signedContributionAndProof: altair.SignedContributionAndProof,
  skipValidationKnownParticipants = false
): Promise<{syncCommitteeParticipantIndices: ValidatorIndex[]}> {
  const contributionAndProof = signedContributionAndProof.message;
  const {contribution, aggregatorIndex} = contributionAndProof;
  const {subcommitteeIndex, slot} = contribution;

  const headState = chain.getHeadState();
  validateGossipSyncCommitteeExceptSig(chain, headState, subcommitteeIndex, {
    slot,
    validatorIndex: contributionAndProof.aggregatorIndex,
  });

  // [IGNORE] The contribution's slot is for the current slot, i.e. contribution.slot == current_slot.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [REJECT] The aggregator's validator index is in the declared subcommittee of the current sync committee
  // -- i.e. state.validators[contribution_and_proof.aggregator_index].pubkey in
  // get_sync_subcommittee_pubkeys(state, contribution.subcommittee_index).
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // _[IGNORE]_ A valid sync committee contribution with equal `slot`, `beacon_block_root` and `subcommittee_index` whose
  // `aggregation_bits` is non-strict superset has _not_ already been seen.
  if (!skipValidationKnownParticipants && chain.seenContributionAndProof.participantsKnown(contribution)) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_PARTICIPANTS_ALREADY_KNOWN,
    });
  }

  // [IGNORE] The sync committee contribution is the first valid contribution received for the aggregator with index
  // contribution_and_proof.aggregator_index for the slot contribution.slot and subcommittee index contribution.subcommittee_index.
  if (chain.seenContributionAndProof.isAggregatorKnown(slot, subcommitteeIndex, aggregatorIndex)) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_AGGREGATOR_ALREADY_KNOWN,
    });
  }

  // [REJECT] The contribution has participants -- that is, any(contribution.aggregation_bits)
  const syncCommitteeParticipantIndices = getContributionIndices(headState as CachedBeaconStateAltair, contribution);
  if (syncCommitteeParticipantIndices.length === 0) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.NO_PARTICIPANT,
    });
  }

  // [REJECT] contribution_and_proof.selection_proof selects the validator as an aggregator for the slot --
  // i.e. is_sync_committee_aggregator(contribution_and_proof.selection_proof) returns True.
  if (!isSyncCommitteeAggregator(contributionAndProof.selectionProof)) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_AGGREGATOR,
      aggregatorIndex: contributionAndProof.aggregatorIndex,
    });
  }

  // [REJECT] The aggregator's validator index is in the declared subcommittee of the current sync committee --
  // i.e. state.validators[contribution_and_proof.aggregator_index].pubkey in get_sync_subcommittee_pubkeys(state, contribution.subcommittee_index).
  // > Checked in validateGossipSyncCommitteeExceptSig()

  const participantPubkeys = syncCommitteeParticipantIndices.map(
    (validatorIndex) => headState.epochCtx.index2pubkey[validatorIndex]
  );
  const signatureSets = [
    // [REJECT] The contribution_and_proof.selection_proof is a valid signature of the SyncAggregatorSelectionData
    // derived from the contribution by the validator with index contribution_and_proof.aggregator_index.
    getSyncCommitteeSelectionProofSignatureSet(headState, contributionAndProof),

    // [REJECT] The aggregator signature, signed_contribution_and_proof.signature, is valid.
    getContributionAndProofSignatureSet(headState, signedContributionAndProof),

    // [REJECT] The aggregate signature is valid for the message beacon_block_root and aggregate pubkey derived from
    // the participation info in aggregation_bits for the subcommittee specified by the contribution.subcommittee_index.
    getSyncCommitteeContributionSignatureSet(headState as CachedBeaconStateAltair, contribution, participantPubkeys),
  ];

  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
    });
  }

  // no need to add to seenSyncCommittteeContributionCache here, gossip handler will do that
  chain.seenContributionAndProof.add(contributionAndProof, syncCommitteeParticipantIndices.length);

  return {syncCommitteeParticipantIndices};
}

/**
 * Retrieve pubkeys in contribution aggregate using epochCtx:
 * - currSyncCommitteeIndexes cache
 * - index2pubkey cache
 */
function getContributionIndices(
  state: CachedBeaconStateAltair,
  contribution: altair.SyncCommitteeContribution
): ValidatorIndex[] {
  const startIndex = contribution.subcommitteeIndex * SYNC_COMMITTEE_SUBNET_SIZE;

  const syncCommittee = state.epochCtx.getIndexedSyncCommittee(contribution.slot);
  // The bits in contribution.aggregationBits select validatorIndexes in the subcommittee starting at startIndex
  const subcommitteeIndices = syncCommittee.validatorIndices.slice(startIndex, startIndex + SYNC_COMMITTEE_SUBNET_SIZE);
  return contribution.aggregationBits.intersectValues(subcommitteeIndices);
}
