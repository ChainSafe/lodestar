import {aggregatePublicKeys, PublicKey, SecretKey} from "@chainsafe/bls";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  FINALIZED_ROOT_GINDEX,
  NEXT_SYNC_COMMITTEE_GINDEX,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";
import {assertValidLightClientUpdate} from "../../src/validation";
import {LightClientSnapshotFast, SyncCommitteeFast} from "../../src/types";
import {defaultBeaconBlockHeader, getSyncAggregateSigningRoot, signAndAggregate} from "../utils";

describe("validateLightClientUpdate", () => {
  const genValiRoot = Buffer.alloc(32, 9);
  const config = createIBeaconConfig(chainConfig, genValiRoot);

  let update: altair.LightClientUpdate;
  let snapshot: LightClientSnapshotFast;

  before("Prepare data", () => {
    // Update slot must > snapshot slot
    // updatePeriod must == snapshotPeriod + 1
    const snapshotHeaderSlot = 1;
    const updateHeaderSlot = EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH + 1;
    const attestedHeaderSlot = updateHeaderSlot + 1;

    const skBytes: Buffer[] = [];
    for (let i = 0; i < SYNC_COMMITTEE_SIZE; i++) {
      const buffer = Buffer.alloc(32, 0);
      buffer.writeInt16BE(i + 1, 30); // Offset to ensure the SK is less than the order
      skBytes.push(buffer);
    }
    const sks = skBytes.map((skBytes) => SecretKey.fromBytes(skBytes));
    const pks = sks.map((sk) => sk.toPublicKey());
    const pubkeys = pks.map((pk) => pk.toBytes());

    // Create a sync committee with the keys that will sign the `syncAggregate`
    const nextSyncCommittee: altair.SyncCommittee = {
      pubkeys,
      aggregatePubkey: aggregatePublicKeys(pubkeys),
    };

    // finalizedCheckpointState must have `nextSyncCommittee`
    const finalizedCheckpointState = ssz.altair.BeaconState.defaultTreeBacked();
    finalizedCheckpointState.nextSyncCommittee = nextSyncCommittee;
    // Prove it
    const nextSyncCommitteeBranch = finalizedCheckpointState.tree.getSingleProof(BigInt(NEXT_SYNC_COMMITTEE_GINDEX));

    // update.header must have stateRoot to finalizedCheckpointState
    const finalizedHeader = defaultBeaconBlockHeader(updateHeaderSlot);
    finalizedHeader.stateRoot = ssz.altair.BeaconState.hashTreeRoot(finalizedCheckpointState);

    // syncAttestedState must have `header` as finalizedCheckpoint
    const syncAttestedState = ssz.altair.BeaconState.defaultTreeBacked();
    syncAttestedState.finalizedCheckpoint = {
      epoch: 0,
      root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(finalizedHeader),
    };
    // Prove it
    const finalityBranch = syncAttestedState.tree.getSingleProof(BigInt(FINALIZED_ROOT_GINDEX));

    // finalityHeader must have stateRoot to syncAttestedState
    const syncAttestedBlockHeader = defaultBeaconBlockHeader(attestedHeaderSlot);
    syncAttestedBlockHeader.stateRoot = ssz.altair.BeaconState.hashTreeRoot(syncAttestedState);

    const forkVersion = ssz.Bytes4.defaultValue();
    const signingRoot = getSyncAggregateSigningRoot(config, syncAttestedBlockHeader);
    const syncAggregate = signAndAggregate(signingRoot, sks);

    const syncCommittee: SyncCommitteeFast = {
      pubkeys: pks,
      aggregatePubkey: PublicKey.fromBytes(aggregatePublicKeys(pubkeys)),
    };

    update = {
      attestedHeader: syncAttestedBlockHeader,
      nextSyncCommittee: nextSyncCommittee,
      nextSyncCommitteeBranch: nextSyncCommitteeBranch,
      finalizedHeader: finalizedHeader,
      finalityBranch: finalityBranch,
      syncAggregate,
      forkVersion,
    };

    snapshot = {
      header: defaultBeaconBlockHeader(snapshotHeaderSlot),
      currentSyncCommittee: syncCommittee,
      nextSyncCommittee: syncCommittee,
    };
  });

  it("Validate valid update", () => {
    assertValidLightClientUpdate(config, snapshot.nextSyncCommittee, update);
  });
});
