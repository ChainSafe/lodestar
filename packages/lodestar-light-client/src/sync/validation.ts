import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient} from "@chainsafe/lodestar-types";
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

export function isValidLightclientUpdate(
  config: IBeaconConfig,
  snapshot: lightclient.LightclientSnapshot,
  update: lightclient.LightclientUpdate
): boolean {
  assert.gt(update.header.slot, snapshot.header.slot, "update slot is less or equal snapshot slot");
  const snapshotPeriod = intDiv(
    computeEpochAtSlot(config, snapshot.header.slot),
    config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
  );
  const updatePeriod = intDiv(
    computeEpochAtSlot(config, update.header.slot),
    config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
  );
  assert.true(
    snapshotPeriod <= updatePeriod && updatePeriod <= snapshotPeriod + 1,
    "Update skips a sync committee period"
  );
  let signedHeader;
  if (
    config.types.lightclient.BeaconBlockHeader.equals(
      update.finalityHeader,
      config.types.lightclient.BeaconBlockHeader.defaultValue()
    )
  ) {
    signedHeader = update.header;
    assert.equal(update.finalityBranch.length, Math.log2(FINALIZED_ROOT_INDEX));
    for (const root of update.finalityBranch) {
      assert.true(config.types.Root.equals(root, ZERO_HASH));
    }
  } else {
    signedHeader = update.finalityHeader;
    verifyMerkleBranch(
      config.types.lightclient.BeaconBlockHeader.hashTreeRoot(update.header),
      Array.from(update.finalityBranch).map((i) => i.valueOf() as Uint8Array),
      Math.log2(FINALIZED_ROOT_INDEX),
      FINALIZED_ROOT_INDEX % 2 ** Math.log2(FINALIZED_ROOT_INDEX),
      update.finalityHeader.stateRoot.valueOf() as Uint8Array
    );
  }
  let syncCommittee: lightclient.SyncCommittee;
  if (updatePeriod === snapshotPeriod) {
    syncCommittee = snapshot.currentSyncCommittee;
    assert.equal(update.nextSyncCommitteeBranch.length, Math.log2(NEXT_SYNC_COMMITTEE_INDEX));
    for (const root of update.nextSyncCommitteeBranch) {
      assert.true(config.types.Root.equals(root, ZERO_HASH));
    }
  } else {
    syncCommittee = snapshot.nextSyncCommittee;
    verifyMerkleBranch(
      config.types.lightclient.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
      Array.from(update.nextSyncCommitteeBranch).map((i) => i.valueOf() as Uint8Array),
      Math.log2(NEXT_SYNC_COMMITTEE_INDEX),
      NEXT_SYNC_COMMITTEE_INDEX % 2 ** Math.log2(NEXT_SYNC_COMMITTEE_INDEX),
      update.header.stateRoot.valueOf() as Uint8Array
    );
  }
  assert.gte(Array.from(update.syncCommitteeBits).filter((bit) => !!bit).length, MIN_SYNC_COMMITTEE_PARTICIPANTS);
  const participantPubkeys: Uint8Array[] = [];
  for (const bit of Array.from(update.syncCommitteeBits)) {
    if (bit) {
      participantPubkeys.push(syncCommittee.pubkeys.valueOf() as Uint8Array);
    }
  }
  const domain = computeDomain(config, config.params.DOMAIN_SYNC_COMMITTEE, update.forkVersion);
  const signingRoot = computeSigningRoot(config, config.types.lightclient.BeaconBlockHeader, signedHeader, domain);
  assert.true(verifyAggregate(participantPubkeys, signingRoot, update.syncCommitteeSignature.valueOf() as Uint8Array));
  return true;
}
