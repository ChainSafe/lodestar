import {ByteVector, toHexString, TreeBacked} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

export interface IStateContextCacheItem {
  state: TreeBacked<BeaconState>;
  epochCtx?: EpochContext;
}

/**
 * Simple BeaconState in-memory cache
 *
 * Similar API to Repository, but synchronous
 */
export class StateContextCache {
  private cache: Record<string, IStateContextCacheItem>;
  constructor() {
    this.cache = {};
  }

  public async get(root: ByteVector): Promise<IStateContextCacheItem | null> {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx ? item.epochCtx.copy() : null
    };
  }

  public async add(state: TreeBacked<BeaconState>, epochContext?: EpochContext): Promise<void> {
    this.cache[toHexString(state.hashTreeRoot())] = {
      state: state.clone(),
      epochCtx: epochContext.copy()
    };
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

  public async values(): Promise<IStateContextCacheItem[]> {
    return Object.values(this.cache);
  }
}
