import {aggregatePublicKeys, PublicKey, SecretKey} from "@chainsafe/bls";
import {altair} from "@chainsafe/lodestar-types";
import {FINALIZED_ROOT_INDEX, NEXT_SYNC_COMMITTEE_INDEX} from "@chainsafe/lodestar-params";
import {validateLightClientUpdate} from "../../src/client/validation";
import {LightClientSnapshotFast} from "../../src/client/types";
import {
  createExtraMinimalConfig,
  defaultBeaconBlockHeader,
  getSyncAggregateSigningRoot,
  signAndAggregate,
} from "../utils";

describe("validateLightClientUpdate", () => {
  const config = createExtraMinimalConfig();
  const genValiRoot = Buffer.alloc(32, 9);

  let update: altair.LightClientUpdate;
  let snapshot: LightClientSnapshotFast;

  before("Prepare data", () => {
    // Update slot must > snapshot slot
    // updatePeriod must == snapshotPeriod + 1
    const snapshotHeaderSlot = 1;
    const updateHeaderSlot = config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD * config.params.SLOTS_PER_EPOCH + 1;
    const attestedHeaderSlot = updateHeaderSlot + 1;

    const sks = Array.from({length: config.params.SYNC_COMMITTEE_SIZE}).map((_, i) =>
      SecretKey.fromBytes(Buffer.alloc(32, i + 1))
    );
    const pks = sks.map((sk) => sk.toPublicKey());
    const pubkeys = pks.map((pk) => pk.toBytes());

    // Create a sync committee with the keys that will sign the `syncAggregate`
    const nextSyncCommittee: altair.SyncCommittee = {
      pubkeys,
      aggregatePubkey: aggregatePublicKeys(pubkeys),
    };

    // finalizedCheckpointState must have `nextSyncCommittee`
    const finalizedCheckpointState = config.types.altair.BeaconState.defaultTreeBacked();
    finalizedCheckpointState.nextSyncCommittee = nextSyncCommittee;
    // Prove it
    const nextSyncCommitteeBranch = finalizedCheckpointState.tree.getSingleProof(BigInt(NEXT_SYNC_COMMITTEE_INDEX));

    // update.header must have stateRoot to finalizedCheckpointState
    const header = defaultBeaconBlockHeader(config, updateHeaderSlot);
    header.stateRoot = config.types.altair.BeaconState.hashTreeRoot(finalizedCheckpointState);

    // syncAttestedState must have `header` as finalizedCheckpoint
    const syncAttestedState = config.types.altair.BeaconState.defaultTreeBacked();
    syncAttestedState.finalizedCheckpoint = {
      epoch: 0,
      root: config.types.phase0.BeaconBlockHeader.hashTreeRoot(header),
    };
    // Prove it
    const finalityBranch = syncAttestedState.tree.getSingleProof(BigInt(FINALIZED_ROOT_INDEX));

    // finalityHeader must have stateRoot to syncAttestedState
    const syncAttestedBlockHeader = defaultBeaconBlockHeader(config, attestedHeaderSlot);
    syncAttestedBlockHeader.stateRoot = config.types.altair.BeaconState.hashTreeRoot(syncAttestedState);

    const forkVersion = config.types.Bytes4.defaultValue();
    const signingRoot = getSyncAggregateSigningRoot(config, genValiRoot, forkVersion, syncAttestedBlockHeader);
    const syncAggregate = signAndAggregate(signingRoot, sks);

    update = {
      header,
      nextSyncCommittee: nextSyncCommittee,
      nextSyncCommitteeBranch: nextSyncCommitteeBranch,
      finalityHeader: syncAttestedBlockHeader,
      finalityBranch: finalityBranch,
      syncCommitteeBits: syncAggregate.syncCommitteeBits,
      syncCommitteeSignature: syncAggregate.syncCommitteeSignature,
      forkVersion,
    };

    snapshot = {
      header: defaultBeaconBlockHeader(config, snapshotHeaderSlot),
      currentSyncCommittee: {
        pubkeys: pks,
        aggregatePubkey: PublicKey.fromBytes(aggregatePublicKeys(pubkeys)),
      },
      nextSyncCommittee: {
        pubkeys: pks,
        aggregatePubkey: PublicKey.fromBytes(aggregatePublicKeys(pubkeys)),
      },
    };
  });

  it("Validate valid update", () => {
    validateLightClientUpdate(config, snapshot, update, genValiRoot);
  });
});
