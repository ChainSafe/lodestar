import {ByteVector, toHexString, TreeBacked} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {StateRepository} from "./repositories/state";

export interface ITreeStateContext {
  state: TreeBacked<BeaconState>;
  epochCtx: EpochContext;
}

/**
 * In memory cache of BeaconState and connected EpochContext.
 * It also forward calls to state repository.
 *
 * Similar API to Repository
 */
export class StateContextCache {
  private stateRepo: StateRepository;
  private cache: Record<string, ITreeStateContext>;
  constructor(stateRepo: StateRepository) {
    this.stateRepo = stateRepo;
    this.cache = {};
  }

  public async get(root: ByteVector): Promise<ITreeStateContext | null> {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return this.clone(item);
  }

  /**
   * Add to both in-memory cache and state repository.
   */
  public async add(item: ITreeStateContext): Promise<void> {
    this.cache[toHexString(item.state.hashTreeRoot())] = this.clone(item);
    await this.stateRepo.add(item.state);
  }

  /**
   * Delete state both in-memory cache and state repository.
   */
  public async delete(root: ByteVector): Promise<void> {
    delete this.cache[toHexString(root)];
    await this.stateRepo.delete(root as Uint8Array);
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
   * Only prune in-memory cache.
   * States are still stored in state repository.
   * TODO make this more robust.
   * Without more thought, this currently breaks our assumptions about recent state availablity
   */
  public prune(): void {
    const MAX_STATES = 128;
    const keys = Object.keys(this.cache);
    if (keys.length > MAX_STATES) {
      // object keys are stored in insertion order, delete keys starting from the front (but keeping the first)
      keys.slice(1, MAX_STATES - keys.length).forEach((key) => {
        delete this.cache[key];
      });
    }
  }

  /**
   * Should only use this with care as this is expensive.
   * @param epoch
   */
  public async valuesUnsafe(): Promise<ITreeStateContext[]> {
    return Object.values(this.cache).map((item) => this.clone(item));
  }

  private clone(item: ITreeStateContext): ITreeStateContext {
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx.copy(),
    };
  }
}
