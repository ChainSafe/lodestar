import {toHexString} from "@chainsafe/ssz";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {SYNC_COMMITTEE_SUBNET_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {altair} from "@lodestar/types";
import {GossipAction, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";
import {getSyncCommitteeSignatureSet} from "./signatureSets/index.js";

type IndexInSubcommittee = number;

/**
 * Spec v1.1.0-alpha.8
 */
export async function validateGossipSyncCommittee(
  chain: IBeaconChain,
  syncCommittee: altair.SyncCommitteeMessage,
  subnet: number
): Promise<{indexInSubcommittee: IndexInSubcommittee}> {
  const {slot, validatorIndex, beaconBlockRoot} = syncCommittee;
  const messageRoot = toHexString(beaconBlockRoot);

  const headState = chain.getHeadState();
  const indexInSubcommittee = validateGossipSyncCommitteeExceptSig(chain, headState, subnet, syncCommittee);

  // [IGNORE] The signature's slot is for the current slot, i.e. sync_committee_signature.slot == current_slot.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [REJECT] The subnet_id is valid for the given validator, i.e. subnet_id in compute_subnets_for_sync_committee(state,
  // sync_committee_message.validator_index). Note this validation implies the validator is part of the broader current
  // sync committee along with the correct subcommittee.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [IGNORE] There has been no other valid sync committee signature for the declared slot for the validator referenced
  // by sync_committee_signature.validator_index.
  const prevRoot = chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex);
  if (prevRoot) {
    let shouldIgnore = false;
    if (prevRoot === messageRoot) {
      shouldIgnore = true;
    } else {
      const headRoot = chain.forkChoice.getHeadRoot();
      chain.metrics?.gossipSyncCommittee.equivocationCount.inc();
      if (messageRoot === headRoot) {
        chain.metrics?.gossipSyncCommittee.equivocationToHeadCount.inc();
      } else {
        shouldIgnore = true;
      }
    }

    if (shouldIgnore) {
      throw new SyncCommitteeError(GossipAction.IGNORE, {
        code: SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN,
        validatorIndex,
        slot,
        prevRoot,
        newRoot: messageRoot,
      });
    }
  }

  // [REJECT] The subnet_id is valid for the given validator, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index).
  // Note this validation implies the validator is part of the broader current sync committee along with the correct subcommittee.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [REJECT] The signature is valid for the message beacon_block_root for the validator referenced by validator_index.
  await validateSyncCommitteeSigOnly(chain, headState, syncCommittee);

  // Register this valid item as seen
  chain.seenSyncCommitteeMessages.add(slot, subnet, validatorIndex, messageRoot);

  return {indexInSubcommittee};
}

export async function validateApiSyncCommittee(
  chain: IBeaconChain,
  headState: CachedBeaconStateAllForks,
  syncCommittee: altair.SyncCommitteeMessage
): Promise<void> {
  const prioritizeBls = true;
  return validateSyncCommitteeSigOnly(chain, headState, syncCommittee, prioritizeBls);
}

/**
 * Abstracted so it can be re-used in API validation.
 */
async function validateSyncCommitteeSigOnly(
  chain: IBeaconChain,
  headState: CachedBeaconStateAllForks,
  syncCommittee: altair.SyncCommitteeMessage,
  prioritizeBls = false
): Promise<void> {
  const signatureSet = getSyncCommitteeSignatureSet(headState, syncCommittee);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
    });
  }
}

/**
 * Spec v1.1.0-alpha.8
 */
export function validateGossipSyncCommitteeExceptSig(
  chain: IBeaconChain,
  headState: CachedBeaconStateAllForks,
  subnet: number,
  data: Pick<altair.SyncCommitteeMessage, "slot" | "validatorIndex">
): IndexInSubcommittee {
  const {slot, validatorIndex} = data;
  // [IGNORE] The signature's slot is for the current slot, i.e. sync_committee_signature.slot == current_slot.
  // (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  if (!chain.clock.isCurrentSlotGivenGossipDisparity(slot)) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.NOT_CURRENT_SLOT,
      currentSlot: chain.clock.currentSlot,
      slot,
    });
  }

  // [REJECT] The subcommittee index is in the allowed range, i.e. contribution.subcommittee_index < SYNC_COMMITTEE_SUBNET_COUNT.
  if (subnet >= SYNC_COMMITTEE_SUBNET_COUNT) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.INVALID_SUBCOMMITTEE_INDEX,
      subcommitteeIndex: subnet,
    });
  }

  // [REJECT] The subnet_id is valid for the given validator, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index).
  // Note this validation implies the validator is part of the broader current sync committee along with the correct subcommittee.
  const indexInSubcommittee = getIndexInSubcommittee(headState, subnet, data);
  if (indexInSubcommittee === null) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE,
      validatorIndex,
    });
  }

  return indexInSubcommittee;
}

/**
 * Returns the IndexInSubcommittee of the given `subnet`.
 * Returns `null` if not part of the sync committee or not part of the given `subnet`
 */
function getIndexInSubcommittee(
  headState: CachedBeaconStateAllForks,
  subnet: number,
  data: Pick<altair.SyncCommitteeMessage, "slot" | "validatorIndex">
): IndexInSubcommittee | null {
  const syncCommittee = headState.epochCtx.getIndexedSyncCommittee(data.slot);
  const indexesInCommittee = syncCommittee.validatorIndexMap.get(data.validatorIndex);
  if (indexesInCommittee === undefined) {
    // Not part of the sync committee
    return null;
  }

  for (const indexInCommittee of indexesInCommittee) {
    if (Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE) === subnet) {
      return indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
    }
  }

  // Not part of this specific subnet
  return null;
}
