import {ByteVector, toHexString} from "@chainsafe/ssz";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

/**
 * In memory cache of CachedBeaconState
 *
 * Similar API to Repository
 */
export class StateContextCache {
  private cache: Record<string, CachedBeaconState>;
  constructor() {
    this.cache = {};
  }

  public async get(root: ByteVector): Promise<CachedBeaconState | null> {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return item.clone();
  }

  public async add(item: CachedBeaconState): Promise<void> {
    this.cache[toHexString(item.getTreeBackedState().hashTreeRoot())] = item.clone();
  }

  public async delete(root: ByteVector): Promise<void> {
    delete this.cache[toHexString(root)];
  }

  public async batchDelete(roots: ByteVector[]): Promise<void> {
    await Promise.all(roots.map((root) => this.delete(root)));
  }

  public clear(): void {
    this.cache = {};
  }

  public get size(): number {
    return Object.keys(this.cache).length;
  }

  /**
   * TODO make this more robust.
   * Without more thought, this currently breaks our assumptions about recent state availablity
   */
  public prune(headStateRoot: ByteVector): void {
    const MAX_STATES = 96;
    const keys = Object.keys(this.cache);
    if (keys.length > MAX_STATES) {
      const headStateRootHex = toHexString(headStateRoot);
      // object keys are stored in insertion order, delete keys starting from the front
      for (const key of keys.slice(0, keys.length - MAX_STATES)) {
        if (key !== headStateRootHex) {
          delete this.cache[key];
        }
      }
    }
  }

  /**
   * Should only use this with care as this is expensive.
   * @param epoch
   */
  public async valuesUnsafe(): Promise<CachedBeaconState[]> {
    return Object.values(this.cache).map((item) => item.clone());
  }
}
