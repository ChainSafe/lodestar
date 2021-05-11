import {CachedBeaconState, isSyncCommitteeAggregator} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {altair} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {GossipAction, IContributionAndProofJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors";
import {IBeaconChain} from "../interface";
import {validateGossipSyncCommitteeExceptSig} from "./syncCommittee";
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
  job: IContributionAndProofJob
): Promise<void> {
  const signedContributionAndProof = job.contributionAndProof;
  const contributionAndProof = signedContributionAndProof.message;
  const contribution = contributionAndProof.contribution;
  const subCommitteeIndex = contribution.subCommitteeIndex;
  const subnet = subCommitteeIndex;

  const headState = chain.getHeadState();
  validateGossipSyncCommitteeExceptSig(chain, headState, subnet, {
    slot: contribution.slot,
    beaconBlockRoot: contribution.beaconBlockRoot,
    validatorIndex: contributionAndProof.aggregatorIndex,
  });

  // [IGNORE] The contribution's slot is for the current slot, i.e. contribution.slot == current_slot.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [IGNORE] The block being signed over (contribution.beacon_block_root) has been seen (via both gossip and non-gossip sources).
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [REJECT] The subcommittee index is in the allowed range, i.e. contribution.subcommittee_index < SYNC_COMMITTEE_SUBNET_COUNT.
  if (subCommitteeIndex >= SYNC_COMMITTEE_SUBNET_COUNT) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX,
      subCommitteeIndex,
    });
  }

  // [IGNORE] The sync committee contribution is the first valid contribution received for the aggregator with index
  // contribution_and_proof.aggregator_index for the slot contribution.slot and subcommittee index contribution.subcommittee_index.
  if (db.syncCommitteeContribution.has(contributionAndProof)) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN,
    });
  }

  // [REJECT] contribution_and_proof.selection_proof selects the validator as an aggregator for the slot --
  // i.e. is_sync_committee_aggregator(contribution_and_proof.selection_proof) returns True.
  if (!isSyncCommitteeAggregator(config, contributionAndProof.selectionProof)) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_AGGREGATOR,
      aggregatorIndex: contributionAndProof.aggregatorIndex,
    });
  }

  // [REJECT] The aggregator's validator index is in the declared subcommittee of the current sync committee --
  // i.e. state.validators[contribution_and_proof.aggregator_index].pubkey in get_sync_subcommittee_pubkeys(state, contribution.subcommittee_index).
  // > Checked in validateGossipSyncCommitteeExceptSig()

  const signatureSets = [
    // [REJECT] The contribution_and_proof.selection_proof is a valid signature of the SyncAggregatorSelectionData
    // derived from the contribution by the validator with index contribution_and_proof.aggregator_index.
    getSyncCommitteeSelectionProofSignatureSet(headState, contributionAndProof),

    // [REJECT] The aggregator signature, signed_contribution_and_proof.signature, is valid.
    getContributionAndProofSignatureSet(headState, signedContributionAndProof),

    // [REJECT] The aggregate signature is valid for the message beacon_block_root and aggregate pubkey derived from
    // the participation info in aggregation_bits for the subcommittee specified by the contribution.subcommittee_index.
    getSyncCommitteeContributionSignatureSet(headState as CachedBeaconState<altair.BeaconState>, contribution),
  ];

  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
    });
  }
  // no need to add to seenSyncCommittteeContributionCache here, gossip handler will do that
}
