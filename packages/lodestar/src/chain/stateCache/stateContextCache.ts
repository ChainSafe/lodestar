import {ByteVector, toHexString} from "@chainsafe/ssz";
import {phase0, Epoch} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

const MAX_STATES = 96;

/**
 * In memory cache of CachedBeaconState
 *
 * Similar API to Repository
 */
export class StateContextCache {
  /**
   * Max number of states allowed in the cache
   */
  maxStates: number;

  private cache: Record<string, CachedBeaconState<phase0.BeaconState>>;
  /**
   * Epoch -> Set<blockRoot>
   */
  private epochIndex: Record<Epoch, Set<string>>;

  constructor(maxStates = MAX_STATES) {
    this.cache = {};
    this.epochIndex = {};
    this.maxStates = maxStates;
  }

  get(root: ByteVector): CachedBeaconState<phase0.BeaconState> | null {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return item.clone();
  }

  add(item: CachedBeaconState<phase0.BeaconState>): void {
    const key = toHexString(item.hashTreeRoot());
    if (this.cache[key]) {
      return;
    }
    this.cache[key] = item.clone();
    const epoch = item.epochCtx.currentShuffling.epoch;
    if (this.epochIndex[epoch]) {
      this.epochIndex[epoch].add(key);
    } else {
      this.epochIndex[epoch] = new Set([key]);
    }
  }

  delete(root: ByteVector): void {
    const key = toHexString(root);
    const item = this.cache[key];
    if (!item) return;
    this.epochIndex[item.epochCtx.currentShuffling.epoch].delete(key);
    delete this.cache[key];
  }

  batchDelete(roots: ByteVector[]): void {
    roots.map((root) => this.delete(root));
  }

  clear(): void {
    this.cache = {};
  }

  get size(): number {
    return Object.keys(this.cache).length;
  }

  /**
   * TODO make this more robust.
   * Without more thought, this currently breaks our assumptions about recent state availablity
   */
  prune(headStateRoot: ByteVector): void {
    const keys = Object.keys(this.cache);
    if (keys.length > this.maxStates) {
      const headStateRootHex = toHexString(headStateRoot);
      // object keys are stored in insertion order, delete keys starting from the front
      for (const key of keys.slice(0, keys.length - this.maxStates)) {
        if (key !== headStateRootHex) {
          const item = this.cache[key];
          this.epochIndex[item.epochCtx.currentShuffling.epoch].delete(key);
          delete this.cache[key];
        }
      }
    }
  }

  /**
   * Prune per finalized epoch.
   */
  async deleteAllBeforeEpoch(finalizedEpoch: Epoch): Promise<void> {
    for (const epoch of Object.keys(this.epochIndex).map(Number)) {
      if (epoch < finalizedEpoch) {
        this.deleteAllEpochItems(epoch);
      }
    }
  }

  /**
   * Should only use this with care as this is expensive.
   * @param epoch
   */
  valuesUnsafe(): CachedBeaconState<phase0.BeaconState>[] {
    return Object.values(this.cache).map((item) => item.clone());
  }

  private deleteAllEpochItems(epoch: Epoch): void {
    for (const hexRoot of this.epochIndex[epoch] || []) {
      delete this.cache[hexRoot];
    }
    delete this.epochIndex[epoch];
  }
}
