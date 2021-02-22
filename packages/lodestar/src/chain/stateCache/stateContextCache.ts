import {ByteVector, toHexString, TreeBacked} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ITreeStateContext} from "../interface";

/**
 * In memory cache of BeaconState and connected EpochContext
 *
 * Similar API to Repository
 */
export class StateContextCache {
  private cache: Record<string, ITreeStateContext>;
  constructor() {
    this.cache = {};
  }

  public get(root: ByteVector): ITreeStateContext | null {
    const item = this.cache[toHexString(root)];
    if (!item) {
      return null;
    }
    return this.clone(item);
  }

  public add(item: ITreeStateContext): void {
    this.cache[
      toHexString((item.state.getOriginalState() as TreeBacked<phase0.BeaconState>).hashTreeRoot())
    ] = this.clone(item);
  }

  public delete(root: ByteVector): void {
    delete this.cache[toHexString(root)];
  }

  public batchDelete(roots: ByteVector[]): void {
    roots.map((root) => this.delete(root));
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
  public valuesUnsafe(): ITreeStateContext[] {
    return Object.values(this.cache).map((item) => this.clone(item));
  }

  private clone(item: ITreeStateContext): ITreeStateContext {
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx.copy(),
    };
  }
}
