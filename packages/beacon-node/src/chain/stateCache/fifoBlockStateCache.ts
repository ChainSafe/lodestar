import {routes} from "@lodestar/api";
import {ForkSeq} from "@lodestar/params";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {MapTracker} from "./mapMetrics.js";
import {BlockStateCache} from "./types.js";

export type FIFOBlockStateCacheOpts = {
  maxBlockStates?: number;
};

/**
 * Given `maxSkipSlots` = 32 and `DEFAULT_EARLIEST_PERMISSIBLE_SLOT_DISTANCE` = 32, lodestar doesn't need to
 * reload states in order to process a gossip block.
 *
 * |-----------------------------------------------|-----------------------------------------------|
 *                 maxSkipSlots                      DEFAULT_EARLIEST_PERMISSIBLE_SLOT_DISTANCE    ^
 *                                                                                             clock slot
 */
export const DEFAULT_MAX_BLOCK_STATES = 64;
/**
 * For Gloas (ePBS), each block can have two states: block state and payload state.
 * Double the cache size to maintain the same effective block depth.
 */
export const DEFAULT_MAX_BLOCK_STATES_GLOAS = 128;

/**
 * New implementation of BlockStateCache that keeps the most recent n states consistently
 *  - Maintain a linked list (FIFO) with special handling for head state, which is always the first item in the list
 *  - Prune per add() instead of per checkpoint so it only keeps n historical states consistently, prune from tail
 *  - No need to prune per finalized checkpoint
 *
 * Given this block tree with Block 11 as head:
 * ```
         Block 10
           |
     +-----+-----+
     |           |
  Block 11   Block 12
     ^           |
     |           |
    head       Block 13
 * ```
 * The maintained key order would be: 11 -> 13 -> 12 -> 10, and state 10 will be pruned first.
 */
export class FIFOBlockStateCache implements BlockStateCache {
  /**
   * Max number of states allowed in the cache.
   * Dynamically increases from DEFAULT_MAX_BLOCK_STATES to DEFAULT_MAX_BLOCK_STATES_GLOAS
   * when Gloas fork is reached.
   */
  private maxStates: number;
  /**
   * Flag to track if maxStates has been upgraded for Gloas.
   * Once upgraded, no need to check again.
   */
  private gloasMaxStatesActive = false;

  private readonly cache: MapTracker<string, CachedBeaconStateAllForks>;
  /**
   * Key order to implement FIFO cache
   */
  private readonly keyOrder: LinkedList<string>;
  private readonly metrics: Metrics["stateCache"] | null | undefined;

  constructor(opts: FIFOBlockStateCacheOpts, {metrics}: {metrics?: Metrics | null}) {
    this.maxStates = opts.maxBlockStates ?? DEFAULT_MAX_BLOCK_STATES;
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
   * Get a seed state for state reload, this could be any states. The goal is to have the same
   * base merkle tree for all BeaconState objects across application.
   * See packages/state-transition/src/util/loadState/loadState.ts for more detail
   */
  getSeedState(): CachedBeaconStateAllForks {
    const firstValue = this.cache.values().next();
    if (firstValue.done) {
      // should not happen
      throw Error("No state in FIFOBlockStateCache");
    }

    const firstState = firstValue.value;
    // consumers should not mutate the returned state
    return firstState;
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
    // Dynamically upgrade maxStates when Gloas fork is reached
    // Gloas blocks can have two states (block state and payload state), so we need 2x capacity
    if (!this.gloasMaxStatesActive && item.config.getForkSeq(item.slot) >= ForkSeq.gloas) {
      this.maxStates = DEFAULT_MAX_BLOCK_STATES_GLOAS;
      this.gloasMaxStatesActive = true;
    }

    const key = toRootHex(item.hashTreeRoot());
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
    this.prune(key);
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
  prune(lastAddedKey: string): void {
    while (this.keyOrder.length > this.maxStates) {
      const key = this.keyOrder.last();
      // it does not make sense to prune the last added state
      // this only happens when max state is 1 in a short period of time
      if (key === lastAddedKey) {
        break;
      }
      if (!key) {
        // should not happen
        throw new Error("No key");
      }
      this.keyOrder.pop();
      this.cache.delete(key);
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
      root: toRootHex(state.hashTreeRoot()),
      reads: this.cache.readCount.get(key) ?? 0,
      lastRead: this.cache.lastRead.get(key) ?? 0,
      checkpointState: false,
    }));
  }

  getStates(): IterableIterator<CachedBeaconStateAllForks> {
    return this.cache.values();
  }

  /**
   * For unit test only.
   */
  dumpKeyOrder(): string[] {
    return this.keyOrder.toArray();
  }
}
