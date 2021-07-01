import {Proof} from "@chainsafe/persistent-merkle-tree";
import {Path} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {altair, Epoch, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconDb} from "../../db";
import {StateContextCache} from "../stateCache";

interface ILightClientIniterModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  forkChoice: ForkChoice;
  stateCache: StateContextCache;
}

export function getSyncCommitteesProofPaths(): Path[] {
  const paths: Path[] = [];
  for (let i = 0; i < SYNC_COMMITTEE_SIZE; i++) {
    // hacky, but fetch both the first and second half of the pubkeys
    paths.push(["currentSyncCommittee", "pubkeys", i, 0]);
    paths.push(["currentSyncCommittee", "pubkeys", i, 32]);
    paths.push(["nextSyncCommittee", "pubkeys", i, 0]);
    paths.push(["nextSyncCommittee", "pubkeys", i, 32]);
  }
  paths.push(["currentSyncCommittee", "aggregatePubkey", 0]);
  paths.push(["currentSyncCommittee", "aggregatePubkey", 32]);
  paths.push(["nextSyncCommittee", "aggregatePubkey", 0]);
  paths.push(["nextSyncCommittee", "aggregatePubkey", 32]);
  return paths;
}

/* paths needed to bootstrap the light client */
export const initProofPaths = [
  // initial sync committee list
  ...getSyncCommitteesProofPaths(),
  // required to initialize a slot clock
  ["genesisTime"],
  // required to verify signatures
  ["genesisValidatorsRoot"],
];

/**
 * Compute and cache "init" proofs as the chain advances
 */
export class LightClientIniter {
  private readonly config: IBeaconConfig;
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
    const stateRoot = await this.db.lightClientInitProofStateRoot.get(epoch);
    if (!stateRoot) {
      return null;
    }
    return await this.db.lightClientInitProof.get(stateRoot);
  }

  /**
   * To be called in API route GET /eth/v1/lightclient/init_proof/:state_root
   */
  async getInitProofByStateRoot(stateRoot: Uint8Array): Promise<Proof | null> {
    return await this.db.lightClientInitProof.get(stateRoot);
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
    if (Math.floor(finalizedBlockSlot / SLOTS_PER_EPOCH) < this.config.ALTAIR_FORK_EPOCH) {
      return;
    }

    // fetch the state at the finalized block header, this state will be used to create the init proof
    const finalizedStateRoot = finalizedSummary.stateRoot;
    const finalizedState = this.stateCache.get(finalizedStateRoot);
    if (!finalizedState) {
      throw new Error("State not found in cache");
    }

    const proof = finalizedState.createProof(initProofPaths);
    await Promise.all([
      this.db.lightClientInitProof.put(finalizedStateRoot, proof),
      this.db.lightClientInitProofStateRoot.put(checkpoint.epoch, finalizedStateRoot),
    ]);
  }
}
