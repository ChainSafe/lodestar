import {toHexString} from "@chainsafe/ssz";
import {RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {MapTracker} from "./mapMetrics.js";
import {BlockStateCache} from "./types.js";

export type FIFOBlockStateCacheOpts = {
  maxStates: number;
};

/**
 * New implementation of BlockStateCache that keeps the most recent n states consistently
 *  - Maintain a linked list where the head state is always the first item in the list
 *  - Prune per add() instead of per checkpoint so it only keeps n historical states consistently, prune from tail
 *  - This is FIFO cache except that we only track the last added time, not the last used time
 * because state could be fetched from multiple places, but we only care about the last added time.
 *  - No need to prune per finalized checkpoint
 *
 * Given this block tree with Block 11 as head:
 *       Block 10
           |
     +-----+-----+
     |           |
  Block 11   Block 12
     ^           |
     |           |
    head       Block 13
 *
 * The maintained key order would be: 11 -> 13 -> 12 -> 10, and state 10 will be pruned first.
 */
export class FIFOBlockStateCache implements BlockStateCache {
  /**
   * Max number of states allowed in the cache
   */
  readonly maxStates: number;

  private readonly cache: MapTracker<string, CachedBeaconStateAllForks>;
  /**
   * Key order to implement FIFO cache
   */
  private readonly keyOrder: LinkedList<string>;
  private readonly metrics: Metrics["stateCache"] | null | undefined;

  constructor(opts: FIFOBlockStateCacheOpts, {metrics}: {maxStates?: number; metrics?: Metrics | null}) {
    this.maxStates = opts.maxStates;
    this.cache = new MapTracker(metrics?.stateCache);
    if (metrics) {
      this.metrics = metrics.stateCache;
      metrics.stateCache.size.addCollect(() => metrics.stateCache.size.set(this.cache.size));
    }
    this.keyOrder = new LinkedList();
  }

  /**
   * Set a state as head, happens when importing a block and head block is changed.
   */
  setHeadState(item: CachedBeaconStateAllForks | null): void {
    if (item !== null) {
      this.add(item, true);
    }
  }

  /**
   * Get a state from this cache given a state root hex.
   */
  get(rootHex: RootHex): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const item = this.cache.get(rootHex);
    if (!item) {
      return null;
    }

    this.metrics?.hits.inc();
    this.metrics?.stateClonedCount.observe(item.clonedCount);

    return item;
  }

  /**
   * Add a state to this cache.
   * @param isHead if true, move it to the head of the list. Otherwise add to the 2nd position.
   * In importBlock() steps, normally it'll call add() with isHead = false first. Then call setHeadState() to set the head.
   */
  add(item: CachedBeaconStateAllForks, isHead = false): void {
    const key = toHexString(item.hashTreeRoot());
    if (this.cache.get(key) != null) {
      if (!this.keyOrder.has(key)) {
        throw Error(`State exists but key not found in keyOrder: ${key}`);
      }
      if (isHead) {
        this.keyOrder.moveToHead(key);
      } else {
        this.keyOrder.moveToSecond(key);
      }
      // same size, no prune
      return;
    }

    // new state
    this.metrics?.adds.inc();
    this.cache.set(key, item);
    if (isHead) {
      this.keyOrder.unshift(key);
    } else {
      // insert after head
      const head = this.keyOrder.first();
      if (head == null) {
        // should not happen, however handle just in case
        this.keyOrder.unshift(key);
      } else {
        this.keyOrder.insertAfter(head, key);
      }
    }
    this.prune();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Prune the cache from tail to keep the most recent n states consistently.
   * The tail of the list is the oldest state, in case regen adds back the same state,
   * it should stay next to head so that it won't be pruned right away.
   * The FIFO cache helps with this.
   */
  prune(): void {
    while (this.keyOrder.length > this.maxStates) {
      const key = this.keyOrder.pop();
      if (!key) {
        // should not happen
        throw new Error("No key");
      }
      const item = this.cache.get(key);
      if (item) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * No need for this implementation
   * This is only to conform to the old api
   */
  deleteAllBeforeEpoch(): void {}

  /**
   * ONLY FOR DEBUGGING PURPOSES. For lodestar debug API.
   */
  clear(): void {
    this.cache.clear();
  }

  /** ONLY FOR DEBUGGING PURPOSES. For lodestar debug API */
  dumpSummary(): routes.lodestar.StateCacheItem[] {
    return Array.from(this.cache.entries()).map(([key, state]) => ({
      slot: state.slot,
      root: toHexString(state.hashTreeRoot()),
      reads: this.cache.readCount.get(key) ?? 0,
      lastRead: this.cache.lastRead.get(key) ?? 0,
      checkpointState: false,
    }));
  }

  /**
   * For unit test only.
   */
  dumpKeyOrder(): string[] {
    return this.keyOrder.toArray();
  }
}
