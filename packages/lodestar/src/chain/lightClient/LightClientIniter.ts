import {Proof, ProofType, TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {Epoch, phase0} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {computeSyncPeriodAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconDb} from "../../db";
import {StateContextCache} from "../stateCache";

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
   * To be called in API route GET /eth/v1/lightclient/init_proof/:epoch
   */
  async getInitProofByEpoch(epoch: Epoch): Promise<Proof | null> {
    const currentPeriod = computeSyncPeriodAtEpoch(epoch);
    const nextPeriod = currentPeriod + 1;
    const [stateProof, currentSyncCommitteeProof, nextSyncCommitteeProof] = (await Promise.all([
      this.db.lightClientInitProof.get(epoch),
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
   * On finalized, store a light client init proof and related indices
   */
  async onFinalized(checkpoint: phase0.Checkpoint): Promise<void> {
    // discard any states that occur before altair
    const finalizedSummary = this.forkChoice.getBlock(checkpoint.root);
    if (!finalizedSummary) {
      throw new Error("Block not found in fork choice");
    }
    const finalizedBlockSlot = finalizedSummary.slot;
    const finalizedBlockEpoch = Math.floor(finalizedBlockSlot / SLOTS_PER_EPOCH);
    if (finalizedBlockEpoch < this.config.ALTAIR_FORK_EPOCH) {
      return;
    }

    // fetch the state at the finalized block header, this state will be used to create the init proof
    const finalizedStateRoot = finalizedSummary.stateRoot;
    const finalizedState = this.stateCache.get(finalizedStateRoot);
    if (!finalizedState) {
      throw new Error("State not found in cache");
    }

    // state proof
    const stateProof = finalizedState.createProof(stateProofPaths) as TreeOffsetProof;

    // sync committees stored separately to deduplicate
    const currentPeriod = computeSyncPeriodAtEpoch(finalizedBlockEpoch);
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
    const wsPeriod = allForks.computeWeakSubjectivityPeriodCachedState(this.config, finalizedState);
    const wsEpoch = Math.max(0, finalizedBlockEpoch - wsPeriod);
    const wsSyncPeriod = computeSyncPeriodAtEpoch(wsEpoch);

    const [oldStateProofKeys, oldCommitteeProofKeys] = await Promise.all([
      this.db.lightClientInitProof.keys({lt: wsEpoch}),
      this.db.lightClientSyncCommitteeProof.keys({lt: wsSyncPeriod}),
    ]);

    await Promise.all([
      // prune old proofs
      this.db.lightClientInitProof.batchDelete(oldStateProofKeys),
      this.db.lightClientSyncCommitteeProof.batchDelete(oldCommitteeProofKeys),
      // store state proof
      this.db.lightClientInitProof.put(checkpoint.epoch, stateProof),
      // store sync committee proofs
      this.db.lightClientSyncCommitteeProof.batchPut([
        {key: currentPeriod, value: currentSyncCommitteeProof},
        {key: nextPeriod, value: nextSyncCommitteeProof},
      ]),
    ]);
  }
}
