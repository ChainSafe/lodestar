import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {assert, intDiv, verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {
  FINALIZED_ROOT_INDEX,
  NEXT_SYNC_COMMITTEE_INDEX,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
} from "@chainsafe/lodestar-params";
import {verifyAggregate} from "@chainsafe/bls";
import {
  computeEpochAtSlot,
  ZERO_HASH,
  computeDomain,
  computeSigningRoot,
} from "@chainsafe/lodestar-beacon-state-transition";

/**
 * A light client maintains its state in a store object of type LightClientStore and receives update objects of type LightClientUpdate.
 * Every update triggers process_light_client_update(store, update, current_slot) where current_slot is the current slot based on some local clock.
 *
 * Spec v1.0.1
 */
export function validateAltairUpdate(
  config: IBeaconConfig,
  snapshot: altair.AltairSnapshot,
  update: altair.AltairUpdate
): void {
  // Verify update slot is larger than snapshot slot
  if (update.header.slot <= snapshot.header.slot) {
    throw Error("update slot is less or equal snapshot slot");
  }

  // Verify update does not skip a sync committee period
  const {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} = config.params;
  const snapshotPeriod = intDiv(computeEpochAtSlot(config, snapshot.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  const updatePeriod = intDiv(computeEpochAtSlot(config, update.header.slot), EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
  assert.true(
    snapshotPeriod <= updatePeriod && updatePeriod <= snapshotPeriod + 1,
    "Update skips a sync committee period"
  );

  const FINALIZED_ROOT_INDEX_LOG2 = Math.log2(FINALIZED_ROOT_INDEX);
  const NEXT_SYNC_COMMITTEE_INDEX_LOG2 = Math.log2(NEXT_SYNC_COMMITTEE_INDEX);

  // Verify update header root is the finalized root of the finality header, if specified
  const emptyHeader = config.types.altair.BeaconBlockHeader.defaultValue();
  let signedHeader: altair.BeaconBlockHeader;
  if (config.types.altair.BeaconBlockHeader.equals(update.finalityHeader, emptyHeader)) {
    signedHeader = update.header;
    assert.equal(update.finalityBranch.length, FINALIZED_ROOT_INDEX_LOG2, "Wrong finalityBranch length");
    for (const root of update.finalityBranch) {
      assert.true(config.types.Root.equals(root, ZERO_HASH), "finalityBranches must be zeroed");
    }
  } else {
    signedHeader = update.finalityHeader;
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
  }

  // Verify update next sync committee if the update period incremented
  let syncCommittee: altair.SyncCommittee;
  if (updatePeriod === snapshotPeriod) {
    syncCommittee = snapshot.currentSyncCommittee;
    assert.equal(
      update.nextSyncCommitteeBranch.length,
      NEXT_SYNC_COMMITTEE_INDEX_LOG2,
      "Wrong nextSyncCommitteeBranch length"
    );
    for (const root of update.nextSyncCommitteeBranch) {
      assert.true(config.types.Root.equals(root, ZERO_HASH), "nextSyncCommitteeBranches must be zeroed");
    }
  } else {
    syncCommittee = snapshot.nextSyncCommittee;
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
  }

  // Verify sync committee has sufficient participants
  const syncCommitteeBitsCount = Array.from(update.syncCommitteeBits).filter((bit) => !!bit).length;
  assert.gte(syncCommitteeBitsCount, MIN_SYNC_COMMITTEE_PARTICIPANTS, "Sync committee has not sufficient participants");

  // Verify sync committee aggregate signature
  const participantPubkeys = Array.from(syncCommittee.pubkeys).filter((_, i) => update.syncCommitteeBits[i]);
  const domain = computeDomain(config, config.params.DOMAIN_SYNC_COMMITTEE, update.forkVersion);
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
