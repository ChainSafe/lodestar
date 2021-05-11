import {
  CachedBeaconState,
  computeSubnetsForSyncCommittee,
  getIndicesInSubSyncCommittee,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {IBeaconDb} from "../../db";
import {ISyncCommitteeJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors/syncCommitteeError";
import {IBeaconChain} from "../interface";
import {getSyncCommitteeSignatureSet} from "./signatureSets";

/**
 * Spec v1.1.0-alpha.3
 */
export async function validateGossipSyncCommittee(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  syncCommitteeJob: ISyncCommitteeJob,
  subnet: number
): Promise<void> {
  const {syncCommittee, validSignature} = syncCommitteeJob;
  // [IGNORE] The signature's slot is for the current slot, i.e. sync_committee_signature.slot == current_slot.
  if (chain.clock.currentSlot < syncCommittee.slot) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.FUTURE_SLOT,
      currentSlot: chain.clock.currentSlot,
      syncCommitteeSlot: syncCommittee.slot,
      job: syncCommitteeJob,
    });
  }
  if (chain.clock.currentSlot > syncCommittee.slot) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.PAST_SLOT,
      currentSlot: chain.clock.currentSlot,
      syncCommitteeSlot: syncCommittee.slot,
      job: syncCommitteeJob,
    });
  }

  // [IGNORE] The block being signed over (sync_committee_signature.beacon_block_root) has been seen (via both gossip and non-gossip sources).
  if (!chain.forkChoice.hasBlock(syncCommittee.beaconBlockRoot)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: syncCommittee.beaconBlockRoot as Uint8Array,
      job: syncCommitteeJob,
    });
  }

  // [IGNORE] There has been no other valid sync committee signature for the declared slot for the validator referenced
  // by sync_committee_signature.validator_index.
  if (db.seenSyncCommiteeCache.hasSyncCommitteeSignature(subnet, syncCommittee)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN,
      job: syncCommitteeJob,
    });
  }

  // [REJECT] The subnet_id is valid for the given validator, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index).
  // Note this validation implies the validator is part of the broader current sync committee along with the correct subcommittee.
  const headState = chain.getHeadState();
  const validatorPubkey = headState.validators[syncCommittee.validatorIndex].pubkey;
  const currentSyncCommittee = (headState as CachedBeaconState<altair.BeaconState>).currentSyncCommittee;
  const syncCommitteePubkeys = Array.from(readonlyValues(currentSyncCommittee.pubkeys));
  if (
    syncCommitteePubkeys.findIndex((pubkey) => config.types.phase0.BLSPubkey.equals(pubkey, validatorPubkey)) === -1
  ) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE,
      validatorIndex: syncCommittee.validatorIndex,
      job: syncCommitteeJob,
    });
  }

  // TODO: This check validates the check above implicitly
  // validate subnet
  const expectedSubnets = computeSubnetsForSyncCommittee(
    config,
    headState as CachedBeaconState<altair.BeaconState>,
    syncCommittee.validatorIndex
  );
  if (!expectedSubnets.includes(subnet)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnets,
      job: syncCommitteeJob,
    });
  }

  if (!validSignature) {
    // [REJECT] The signature is valid for the message beacon_block_root for the validator referenced by validator_index.
    const signatureSet = getSyncCommitteeSignatureSet(headState, syncCommittee);
    if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
      throw new SyncCommitteeError({
        code: SyncCommitteeErrorCode.INVALID_SIGNATURE,
        job: syncCommitteeJob,
      });
    }
  }

  const indicesInSubSyncCommittee = getIndicesInSubSyncCommittee(
    config,
    headState as altair.BeaconState,
    subnet,
    syncCommittee.validatorIndex
  );
  db.seenSyncCommiteeCache.addSyncCommitteeSignature(subnet, syncCommittee, indicesInSubSyncCommittee);
}
