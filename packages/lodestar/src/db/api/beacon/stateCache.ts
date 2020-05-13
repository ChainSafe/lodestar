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
  public get(root: ByteVector): TreeBacked<BeaconState> | undefined {
    return this.cache[toHexString(root)];
  }

  public add(state: TreeBacked<BeaconState>): void {
    this.cache[toHexString(state.hashTreeRoot())] = state;
  }

  public delete(root: ByteVector): void {
    delete this.cache[toHexString(root)];
  }

  public clear(): void {
    this.cache = {};
  }

  public values(): TreeBacked<BeaconState>[] {
    return Object.values(this.cache);
  }
}
