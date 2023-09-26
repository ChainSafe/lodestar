import {toHexString} from "@chainsafe/ssz";
import {Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {MapTracker} from "./mapMetrics.js";

// Since Sep 2023, only cache up to 32 states by default. If a big reorg happens it'll load checkpoint state from disk and regen from there.
const DEFAULT_MAX_STATES = 32;

/**
 * In memory cache of CachedBeaconState, this is LRU like cache except that we only track the last added time, not the last used time
 * because state could be fetched from multiple places, but we only care about the last added time.
 *
 * Similar API to Repository
 */
export class StateContextCache {
  /**
   * Max number of states allowed in the cache
   */
  readonly maxStates: number;

  private readonly cache: MapTracker<string, CachedBeaconStateAllForks>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new Map<Epoch, Set<string>>();
  // key order to implement LRU like cache
  private readonly keyOrder: LinkedList<string>;
  private readonly metrics: Metrics["stateCache"] | null | undefined;

  constructor({maxStates = DEFAULT_MAX_STATES, metrics}: {maxStates?: number; metrics?: Metrics | null}) {
    this.maxStates = maxStates;
    this.cache = new MapTracker(metrics?.stateCache);
    if (metrics) {
      this.metrics = metrics.stateCache;
      metrics.stateCache.size.addCollect(() => metrics.stateCache.size.set(this.cache.size));
    }
    this.keyOrder = new LinkedList();
  }

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

  add(item: CachedBeaconStateAllForks): void {
    const key = toHexString(item.hashTreeRoot());
    if (this.cache.get(key)) {
      this.keyOrder.moveToHead(key);
      // same size, no prune
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, item);
    const epoch = item.epochCtx.epoch;
    const blockRoots = this.epochIndex.get(epoch);
    if (blockRoots) {
      blockRoots.add(key);
    } else {
      this.epochIndex.set(epoch, new Set([key]));
    }
    this.keyOrder.unshift(key);
    this.prune();
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * If a recent state is not available, regen from the checkpoint state.
   * Given state 0 => 1 => ... => n, if regen adds back state 0 we should not remove it right away.
   * The LRU-like cache helps with this.
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
        this.epochIndex.get(item.epochCtx.epoch)?.delete(key);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Prune per finalized epoch.
   */
  deleteAllBeforeEpoch(finalizedEpoch: Epoch): void {
    for (const epoch of this.epochIndex.keys()) {
      if (epoch < finalizedEpoch) {
        this.deleteAllEpochItems(epoch);
      }
    }
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

  private deleteAllEpochItems(epoch: Epoch): void {
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      this.cache.delete(rootHex);
    }
    this.epochIndex.delete(epoch);
  }
}
