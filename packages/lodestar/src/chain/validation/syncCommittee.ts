import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {altair} from "@chainsafe/lodestar-types";
import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
import {IBeaconDb} from "../../db";
import {GossipAction, ISyncCommitteeJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors";
import {IBeaconChain} from "../interface";
import {getSyncCommitteeSignatureSet} from "./signatureSets";

/** TODO: Do this much better to be able to access this property in the handler */
export type SyncCommitteeSignatureIndexed = altair.SyncCommitteeSignature & {indexInSubCommittee: number};

type IndexInSubCommittee = number;

/**
 * Spec v1.1.0-alpha.3
 */
export async function validateGossipSyncCommittee(
  chain: IBeaconChain,
  db: IBeaconDb,
  job: ISyncCommitteeJob,
  subnet: number
): Promise<void> {
  const {syncCommittee, validSignature} = job;

  const headState = chain.getHeadState();
  const indexInSubCommittee = validateGossipSyncCommitteeExceptSig(chain, headState, subnet, syncCommittee);

  // TODO: Do this much better to be able to access this property in the handler
  (syncCommittee as SyncCommitteeSignatureIndexed).indexInSubCommittee = indexInSubCommittee;

  // [IGNORE] The signature's slot is for the current slot, i.e. sync_committee_signature.slot == current_slot.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [IGNORE] The block being signed over (sync_committee_signature.beacon_block_root) has been seen (via both gossip and non-gossip sources).
  // > Checked in validateGossipSyncCommitteeExceptSig()

  // [IGNORE] There has been no other valid sync committee signature for the declared slot for the validator referenced
  // by sync_committee_signature.validator_index.
  if (db.syncCommitee.has(subnet, syncCommittee)) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN,
    });
  }

  // [REJECT] The subnet_id is valid for the given validator, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index).
  // Note this validation implies the validator is part of the broader current sync committee along with the correct subcommittee.
  // > Checked in validateGossipSyncCommitteeExceptSig()

  if (!validSignature) {
    // [REJECT] The signature is valid for the message beacon_block_root for the validator referenced by validator_index.
    const signatureSet = getSyncCommitteeSignatureSet(headState, syncCommittee);
    if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
      throw new SyncCommitteeError(GossipAction.REJECT, {
        code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
      });
    }
  }

  // Register this valid item as seen
  db.syncCommitee.seen(subnet, syncCommittee);
}

/**
 * Spec v1.1.0-alpha.3
 */
export function validateGossipSyncCommitteeExceptSig(
  chain: IBeaconChain,
  headState: CachedBeaconState<BeaconState>,
  subnet: number,
  data: Pick<altair.SyncCommitteeSignature, "slot" | "beaconBlockRoot" | "validatorIndex">
): IndexInSubCommittee {
  // [IGNORE] The signature's slot is for the current slot, i.e. sync_committee_signature.slot == current_slot.
  if (chain.clock.currentSlot !== data.slot) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.NOT_CURRENT_SLOT,
      currentSlot: chain.clock.currentSlot,
      slot: data.slot,
    });
  }

  // [IGNORE] The block being signed over (sync_committee_signature.beacon_block_root) has been seen (via both gossip and non-gossip sources).
  if (!chain.forkChoice.hasBlock(data.beaconBlockRoot)) {
    throw new SyncCommitteeError(GossipAction.IGNORE, {
      code: SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: data.beaconBlockRoot as Uint8Array,
    });
  }

  // [REJECT] The subnet_id is valid for the given validator, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index).
  // Note this validation implies the validator is part of the broader current sync committee along with the correct subcommittee.

  // TODO: Cache the indices per sync committee subnet in a Set to prevent having to slice and .includes() every time
  const validatorIndexesInSubnet = headState.currSyncCommitteeIndexes.slice(
    subnet * SYNC_COMMITTEE_SUBNET_COUNT + (subnet + 1) * SYNC_COMMITTEE_SUBNET_COUNT
  );
  const indexInSubCommittee = validatorIndexesInSubnet.indexOf(data.validatorIndex); // -1 -> not found
  if (indexInSubCommittee < 0) {
    throw new SyncCommitteeError(GossipAction.REJECT, {
      code: SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE,
      validatorIndex: data.validatorIndex,
    });
  }

  return indexInSubCommittee;
}
