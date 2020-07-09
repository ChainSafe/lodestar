import {ByteVector, toHexString, TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Epoch, Slot} from "@chainsafe/lodestar-types";
import {EpochContext, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export interface ITreeStateContext {
  state: TreeBacked<BeaconState>;
  epochCtx: EpochContext;
}

/**
 * In memory cache of BeaconState and connected EpochContext
 *
 * Similar API to Repository
 */
export class StateContextCache {
  private config: IBeaconConfig;

  private cache: Record<string, ITreeStateContext>;
  constructor(config: IBeaconConfig) {
    this.config = config;
    this.cache = {};
  }

  public async get(root: ByteVector): Promise<ITreeStateContext | null> {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return this.clone(item);
  }

  public async add(item: ITreeStateContext): Promise<void> {
    this.cache[toHexString(item.state.hashTreeRoot())] = this.clone(item);
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

  /**
   * Should only use this with care as this is expensive.
   * @param epoch
   */
  // public async values(): Promise<ITreeStateContext[]> {
  //   return Object.values(this.cache).map(item => this.clone(item));
  // }

  public async firstStateOfEpoch(epoch: Epoch): Promise<ITreeStateContext | null> {
    const items = Object.values(this.cache).filter(item => computeEpochAtSlot(this.config, item.state.slot) === epoch);
    if (!items || items.length === 0) {
      return null;
    }
    return this.clone(items.sort((a, b) => a.state.slot - b.state.slot)[0]);
  }

  public prune(slot: Slot): void {
    const rootsToDelete =
      Object.values(this.cache).filter(item => item.state.slot < slot).map(item => item.state.hashTreeRoot());
    this.batchDelete(rootsToDelete);
  }

  private clone(item: ITreeStateContext): ITreeStateContext {
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx.copy()
    };
  }
}
