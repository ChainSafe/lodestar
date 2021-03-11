import {ByteVector, toHexString, TreeBacked} from "@chainsafe/ssz";
import {phase0, Epoch} from "@chainsafe/lodestar-types";
import {ITreeStateContext} from "../interface";

const MAX_STATES = 96;

/**
 * In memory cache of BeaconState and connected EpochContext
 *
 * Similar API to Repository
 */
export class StateContextCache {
  /**
   * Max number of states allowed in the cache
   */
  maxStates: number;

  private cache: Record<string, ITreeStateContext>;
  /**
   * Epoch -> Set<blockRoot>
   */
  private epochIndex: Record<Epoch, Set<string>>;

  constructor(maxStates = MAX_STATES) {
    this.cache = {};
    this.epochIndex = {};
    this.maxStates = maxStates;
  }

  get(root: ByteVector): ITreeStateContext | null {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return this.clone(item);
  }

  add(item: ITreeStateContext): void {
    const key = toHexString((item.state.getOriginalState() as TreeBacked<phase0.BeaconState>).hashTreeRoot());
    if (this.cache[key]) {
      return;
    }
    this.cache[key] = this.clone(item);
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
  valuesUnsafe(): ITreeStateContext[] {
    return Object.values(this.cache).map((item) => this.clone(item));
  }

  private deleteAllEpochItems(epoch: Epoch): void {
    for (const hexRoot of this.epochIndex[epoch] || []) {
      delete this.cache[hexRoot];
    }
    delete this.epochIndex[epoch];
  }

  private clone(item: ITreeStateContext): ITreeStateContext {
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx.copy(),
    };
  }
}
