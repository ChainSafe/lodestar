import {
  CachedBeaconState,
  computeSubnetsForSyncCommittee,
  fast,
  getIndicesInSubSyncCommittee,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {ISyncCommitteeJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../errors/syncCommitteeError";
import {IBeaconChain} from "../interface";

export async function validateGossipSyncCommittee(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  syncCommitteeJob: ISyncCommitteeJob,
  subnet: number
): Promise<void> {
  const {syncCommittee, validSignature} = syncCommitteeJob;
  // The signature's slot is for the current slot
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

  // The block being signed over has been seen
  if (!chain.forkChoice.hasBlock(syncCommittee.beaconBlockRoot)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: syncCommittee.beaconBlockRoot as Uint8Array,
      job: syncCommitteeJob,
    });
  }

  // There has been no other valid sync committee signature with same slot and validatorIndex
  if (db.seenSyncCommiteeCache.hasSyncCommitteeSignature(subnet, syncCommittee)) {
    throw new SyncCommitteeError({
      code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN,
      root: config.types.altair.SyncCommitteeSignature.hashTreeRoot(syncCommittee),
      job: syncCommitteeJob,
    });
  }

  const headState = chain.getHeadState();
  // TODO: https://github.com/ChainSafe/ssz/issues/102
  // validate validator being part of the current sync committee
  // const validatorPubkey = headState.validators[syncCommittee.validatorIndex].pubkey;
  // const currentSyncCommittee = (headState as CachedBeaconState<altair.BeaconState>).currentSyncCommittee;
  // const syncCommitteePubkeys = Array.from(readonlyValues(currentSyncCommittee.pubkeys));
  // if (
  //   syncCommitteePubkeys.findIndex((pubkey) => config.types.phase0.BLSPubkey.equals(pubkey, validatorPubkey)) === -1
  // ) {
  //   throw new SyncCommitteeError({
  //     code: SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE,
  //     validatorIndex: syncCommittee.validatorIndex,
  //     job: syncCommitteeJob,
  //   });
  // }

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

  // validate signature
  if (!validSignature) {
    const signatureSet = fast.getSyncCommitteeSignatureSet(headState, syncCommittee);
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
