import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, BLSPubkey} from "@chainsafe/lodestar-types";
import {assert, intDiv, verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {
  FINALIZED_ROOT_INDEX,
  NEXT_SYNC_COMMITTEE_INDEX,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
} from "@chainsafe/lodestar-params";
import {verifyAggregate} from "@chainsafe/bls";
import {computeEpochAtSlot, computeDomain, computeSigningRoot} from "@chainsafe/lodestar-beacon-state-transition";
import {assertZeroHashes, floorlog2, getParticipantPubkeys} from "./utils";
import {BitVector} from "@chainsafe/ssz";

/**
 * Spec v1.0.1
 */
export function validateAltairUpdate(
  config: IBeaconConfig,
  snapshot: altair.AltairSnapshot,
  update: altair.AltairUpdate,
  genesisValidatorsRoot: altair.Root
): void {
  // Verify update slot is larger than snapshot slot
  if (update.header.slot <= snapshot.header.slot) {
    throw Error("update slot is less or equal snapshot slot");
  }

  // Verify update does not skip a sync committee period
  const {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} = config.params;
  const snapshotPeriod = intDiv(computeEpochAtSlot(config, snapshot.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  const updatePeriod = intDiv(computeEpochAtSlot(config, update.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  if (updatePeriod !== snapshotPeriod && updatePeriod !== snapshotPeriod + 1) {
    throw Error("Update skips a sync committee period");
  }

  const FINALIZED_ROOT_INDEX_LOG2 = floorlog2(FINALIZED_ROOT_INDEX);
  const NEXT_SYNC_COMMITTEE_INDEX_LOG2 = floorlog2(NEXT_SYNC_COMMITTEE_INDEX);

  // Verify update header root is the finalized root of the finality header, if specified
  const emptyHeader = config.types.altair.BeaconBlockHeader.defaultValue();
  const finalityHeaderSpecified = !config.types.altair.BeaconBlockHeader.equals(update.finalityHeader, emptyHeader);
  const signedHeader = finalityHeaderSpecified ? update.finalityHeader : update.header;
  if (finalityHeaderSpecified) {
    // Proof that the state referenced in `update.finalityHeader.stateRoot` includes
    // state = {
    //      : update.header
    // }
    //
    // Where `hashTreeRoot(state) == update.finalityHeader.stateRoot`
    assert.true(
      verifyMerkleBranch(
        config.types.altair.BeaconBlockHeader.hashTreeRoot(update.header),
        Array.from(update.finalityBranch).map((i) => i.valueOf() as Uint8Array),
        FINALIZED_ROOT_INDEX_LOG2,
        FINALIZED_ROOT_INDEX % 2 ** FINALIZED_ROOT_INDEX_LOG2,
        update.finalityHeader.stateRoot.valueOf() as Uint8Array
      ),
      "Invalid finality header merkle branch"
    );
  } else {
    assertZeroHashes(update.finalityBranch, FINALIZED_ROOT_INDEX_LOG2, "finalityBranches");
  }

  // Verify update next sync committee if the update period incremented
  const updatePeriodIncremented = updatePeriod > snapshotPeriod;
  const syncCommittee = updatePeriodIncremented ? snapshot.nextSyncCommittee : snapshot.currentSyncCommittee;
  if (updatePeriodIncremented) {
    // Proof that the state referenced in `update.header.stateRoot` includes
    // state = {
    //   nextSyncCommittee: update.nextSyncCommittee
    // }
    //
    // Where `hashTreeRoot(state) == update.header.stateRoot`
    assert.true(
      verifyMerkleBranch(
        config.types.altair.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
        Array.from(update.nextSyncCommitteeBranch).map((i) => i.valueOf() as Uint8Array),
        NEXT_SYNC_COMMITTEE_INDEX_LOG2,
        NEXT_SYNC_COMMITTEE_INDEX % 2 ** NEXT_SYNC_COMMITTEE_INDEX_LOG2,
        update.header.stateRoot.valueOf() as Uint8Array
      ),
      "Invalid next sync committee merkle branch"
    );
  } else {
    assertZeroHashes(update.nextSyncCommitteeBranch, NEXT_SYNC_COMMITTEE_INDEX_LOG2, "nextSyncCommitteeBranches");
  }

  // Verify sync committee has sufficient participants
  const syncCommitteeBitsCount = Array.from(update.syncCommitteeBits).filter((bit) => !!bit).length;
  assert.gte(syncCommitteeBitsCount, MIN_SYNC_COMMITTEE_PARTICIPANTS, "Sync committee has not sufficient participants");

  // Verify sync committee aggregate signature
  //
  // update.syncCommitteeSignature signs over the block at the previous slot of the state it is included
  //
  // ```py
  // previous_slot = max(state.slot, Slot(1)) - Slot(1)
  // domain = get_domain(state, DOMAIN_SYNC_COMMITTEE, compute_epoch_at_slot(previous_slot))
  // signing_root = compute_signing_root(get_block_root_at_slot(state, previous_slot), domain)
  // ```
  // Ref: https://github.com/ethereum/eth2.0-specs/blob/dev/specs/altair/beacon-chain.md#sync-committee-processing
  const participantPubkeys = getParticipantPubkeys(syncCommittee.pubkeys, update.syncCommitteeBits);
  const domain = computeDomain(config, config.params.DOMAIN_SYNC_COMMITTEE, update.forkVersion, genesisValidatorsRoot);
  const signingRoot = computeSigningRoot(config, config.types.altair.BeaconBlockHeader, signedHeader, domain);
  assert.true(
    verifyAggregate(
      participantPubkeys as Uint8Array[],
      signingRoot,
      update.syncCommitteeSignature.valueOf() as Uint8Array
    ),
    "Invalid aggregate signature"
  );
}
