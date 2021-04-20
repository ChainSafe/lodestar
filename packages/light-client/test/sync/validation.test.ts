import {SecretKey} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/minimal";
import {altair} from "@chainsafe/lodestar-types";
import {validateAltairUpdate} from "../../src/sync";
import {defaultBeaconBlockHeader, getSyncAggregateSigningRoot, signAndAggregate} from "./utils";

describe("validateAltairUpdate", () => {
  const genesisValidatorsRoot = Buffer.alloc(32, 9);

  it("Validate valid update", () => {
    // Update slot must > snapshot slot
    // updatePeriod must == snapshotPeriod + 1
    const snapshotHeaderSlot = 1;
    const updateHeaderSlot = config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD * config.params.SLOTS_PER_EPOCH + 1;
    const attestedHeaderSlot = updateHeaderSlot + 1;

    const syncAttestedForkVersion = config.types.Bytes4.defaultValue();
    const sks = Array.from({length: 2}).map((_, i) => SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    const pks = sks.map((sk) => sk.toPublicKey().toBytes());

    // Create a sync committee with the keys that will sign the `syncAggregate`
    const nextSyncCommittee: altair.SyncCommittee = {pubkeys: pks, pubkeyAggregates: []};

    // finalizedCheckpointState must have `nextSyncCommittee`
    const finalizedCheckpointState = config.types.altair.BeaconState.defaultTreeBacked();
    finalizedCheckpointState.nextSyncCommittee = nextSyncCommittee;
    // Prove it
    const nextSyncCommitteeBranch = finalizedCheckpointState.tree.getSingleProof(
      finalizedCheckpointState.type.getPathGindex(["nextSyncCommittee"])
    );

    // update.header must have stateRoot to finalizedCheckpointState
    const header = defaultBeaconBlockHeader(config, updateHeaderSlot);
    header.stateRoot = config.types.altair.BeaconState.hashTreeRoot(finalizedCheckpointState);

    // syncAttestedState must have `header` as finalizedCheckpoint
    const syncAttestedState = config.types.altair.BeaconState.defaultTreeBacked();
    syncAttestedState.finalizedCheckpoint = {
      epoch: 0,
      root: config.types.altair.BeaconBlockHeader.hashTreeRoot(header),
    };
    // Prove it
    const finalityBranch = syncAttestedState.tree.getSingleProof(
      syncAttestedState.type.getPathGindex(["finalizedCheckpoint", "root"])
    );

    // finalityHeader must have stateRoot to syncAttestedState
    const syncAttestedBlockHeader = defaultBeaconBlockHeader(config, attestedHeaderSlot);
    syncAttestedBlockHeader.stateRoot = config.types.altair.BeaconState.hashTreeRoot(syncAttestedState);

    const signingRoot = getSyncAggregateSigningRoot(config, genesisValidatorsRoot, syncAttestedBlockHeader);
    const syncAggregate = signAndAggregate(signingRoot, sks);

    const update: altair.AltairUpdate = {
      header,
      nextSyncCommittee: nextSyncCommittee,
      nextSyncCommitteeBranch: nextSyncCommitteeBranch,
      finalityHeader: syncAttestedBlockHeader,
      finalityBranch: finalityBranch,
      syncCommitteeBits: syncAggregate.syncCommitteeBits,
      syncCommitteeSignature: syncAggregate.syncCommitteeSignature,
      forkVersion: syncAttestedForkVersion,
    };

    const snapshot: altair.AltairSnapshot = {
      header: defaultBeaconBlockHeader(config, snapshotHeaderSlot),
      currentSyncCommittee: {pubkeys: [], pubkeyAggregates: []},
      nextSyncCommittee,
    };

    validateAltairUpdate(config, snapshot, update, genesisValidatorsRoot);
  });
});
