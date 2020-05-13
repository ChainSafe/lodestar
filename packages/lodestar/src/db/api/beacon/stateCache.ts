import {toHexString, TreeBacked, ByteVector} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";

/**
 * Simple BeaconState in-memory cache
 *
 * Similar API to Repository, but synchronous
 */
export class StateCache {
  private cache: Record<string, TreeBacked<BeaconState>>;
  constructor() {
    this.cache = {};
  }
  public async get(root: ByteVector): Promise<TreeBacked<BeaconState> | null> {
    return this.cache[toHexString(root)] || null;
  }

  public async add(state: TreeBacked<BeaconState>): Promise<void> {
    this.cache[toHexString(state.hashTreeRoot())] = state;
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

  public async values(): Promise<TreeBacked<BeaconState>[]> {
    return Object.values(this.cache);
  }
}
