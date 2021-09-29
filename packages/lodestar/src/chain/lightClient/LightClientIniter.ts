import {Proof, ProofType, TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeSyncPeriodAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconDb} from "../../db";
import {StateContextCache} from "../stateCache";
import {intToBytes} from "@chainsafe/lodestar-utils";

interface ILightClientIniterModules {
  config: IChainForkConfig;
  db: IBeaconDb;
  forkChoice: ForkChoice;
  stateCache: StateContextCache;
}

/* paths needed to bootstrap the light client */
export const stateProofPaths = [
  // initial sync committee list
  ["currentSyncCommittee"],
  ["nextSyncCommittee"],
  // required to initialize a slot clock
  ["genesisTime"],
  // required to verify signatures
  ["genesisValidatorsRoot"],
];

const syncProofLeavesLength = SYNC_COMMITTEE_SIZE * 2 + 2;

/**
 * Compute and cache "init" proofs as the chain advances
 */
export class LightClientIniter {
  private readonly config: IChainForkConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: ForkChoice;
  private readonly stateCache: StateContextCache;

  constructor(modules: ILightClientIniterModules) {
    this.config = modules.config;
    this.db = modules.db;
    this.forkChoice = modules.forkChoice;
    this.stateCache = modules.stateCache;
  }

  /**
   * To be called in API route GET /eth/v1/lightclient/init_proof/:blockRoot
   */
  async getInitProofByBlockRoot(blockRoot: Uint8Array): Promise<Proof | null> {
    const blockSlot =
      this.forkChoice.getBlock(blockRoot)?.slot ?? (await this.db.blockArchive.getSlotByRoot(blockRoot));
    if (blockSlot == null) {
      return null;
    }
    const currentPeriod = computeSyncPeriodAtEpoch(computeEpochAtSlot(blockSlot));
    const nextPeriod = currentPeriod + 1;
    const [stateProof, currentSyncCommitteeProof, nextSyncCommitteeProof] = (await Promise.all([
      this.db.lightClientInitProof.get(blockRoot),
      this.db.lightClientSyncCommitteeProof.get(currentPeriod),
      this.db.lightClientSyncCommitteeProof.get(nextPeriod),
    ])) as [TreeOffsetProof | null, TreeOffsetProof | null, TreeOffsetProof | null];
    if (!stateProof || !currentSyncCommitteeProof || !nextSyncCommitteeProof) {
      return null;
    }

    // splice in committee proofs
    stateProof.offsets.splice(
      7,
      0,
      // re-add the offsets we removed
      1,
      syncProofLeavesLength,
      // committee proof offsets
      ...currentSyncCommitteeProof.offsets,
      ...nextSyncCommitteeProof.offsets
    );
    stateProof.leaves.splice(7, 0, ...currentSyncCommitteeProof.leaves, ...nextSyncCommitteeProof.leaves);

    return stateProof;
  }

  /**
   * Must subscribe to BeaconChain event `finalized`
   *
   * Store a light client init proof and related indices and prune old entries
   */
  async onFinalized(checkpoint: phase0.Checkpoint): Promise<void> {
    const checkpointRoot = checkpoint.root.valueOf() as Uint8Array;
    const checkpointBlockSummary = this.forkChoice.getBlock(checkpointRoot);
    if (!checkpointBlockSummary) {
      throw new Error("Block not found in fork choice");
    }
    const checkpointBlockSlot = checkpointBlockSummary.slot;
    const checkpointBlockEpoch = Math.floor(checkpointBlockSlot / SLOTS_PER_EPOCH);
    // discard any states that occur before altair
    if (checkpointBlockEpoch < this.config.ALTAIR_FORK_EPOCH) {
      return;
    }

    // fetch the state at the block header, this state will be used to create the init proof
    const checkpointStateRoot = checkpointBlockSummary.stateRoot;
    const checkpointState = this.stateCache.get(checkpointStateRoot);
    if (!checkpointState) {
      throw new Error("State not found in cache");
    }

    // state proof
    const stateProof = checkpointState.createProof(stateProofPaths) as TreeOffsetProof;

    // sync committees stored separately to deduplicate
    const currentPeriod = computeSyncPeriodAtEpoch(checkpointBlockEpoch);
    const nextPeriod = currentPeriod + 1;

    // Create sync committee proofs by _splicing_ the committee sections out of the state proof

    // We aren't creating the sync committee proofs separately because our ssz library automatically adds leaves to composite types,
    // so they're already included in the state proof, currently with no way to specify otherwise

    // remove two offsets so the # of offsets in the state proof will be the # expected
    // This is a hack, but properly setting the offsets in the state proof would require either removing witnesses needed for the committees
    // or setting the roots of the committees in the state proof
    // this will always be 1, syncProofLeavesLength
    stateProof.offsets.splice(7, 2);

    const currentSyncCommitteeProof: TreeOffsetProof = {
      type: ProofType.treeOffset,
      offsets: stateProof.offsets.splice(7, 1025),
      leaves: stateProof.leaves.splice(7, 1026),
    };

    const nextSyncCommitteeProof: TreeOffsetProof = {
      type: ProofType.treeOffset,
      offsets: stateProof.offsets.splice(7, 1025),
      leaves: stateProof.leaves.splice(7, 1026),
    };

    // calculate beginning of weak subjectivity period to prune from there
    const wsPeriod = allForks.computeWeakSubjectivityPeriodCachedState(this.config, checkpointState);
    const wsEpoch = Math.max(0, checkpointState.finalizedCheckpoint.epoch - wsPeriod);
    const wsSyncPeriod = computeSyncPeriodAtEpoch(wsEpoch);

    // index stored as ${epoch}${blockRoot}
    const oldStateProofIndexKeys = await this.db.lightClientInitProofIndex.keys({lt: intToBytes(wsEpoch, 8)});
    // slice off epoch to retrieve block roots
    const oldStateProofBlockRoots = oldStateProofIndexKeys.map((indexKey) => indexKey.subarray(8));
    const oldCommitteeProofKeys = await this.db.lightClientSyncCommitteeProof.keys({lt: wsSyncPeriod});

    // serialize the checkpoint for the init proof index
    // For easy pruning, the epoch is first
    const serializedCheckpoint = new Uint8Array(40);
    serializedCheckpoint.set(ssz.Epoch.serialize(checkpoint.epoch));
    serializedCheckpoint.set(checkpointRoot, 8);

    await Promise.all([
      // prune old proofs
      this.db.lightClientInitProofIndex.batchDelete(oldStateProofIndexKeys),
      this.db.lightClientInitProof.batchDelete(oldStateProofBlockRoots),
      this.db.lightClientSyncCommitteeProof.batchDelete(oldCommitteeProofKeys),
      // store state proof
      this.db.lightClientInitProofIndex.put(serializedCheckpoint, true),
      this.db.lightClientInitProof.put(checkpointRoot, stateProof),
      // store sync committee proofs
      this.db.lightClientSyncCommitteeProof.batchPut([
        {key: currentPeriod, value: currentSyncCommitteeProof},
        {key: nextPeriod, value: nextSyncCommitteeProof},
      ]),
    ]);
  }
}
