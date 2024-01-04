import {toHexString} from "@chainsafe/ssz";
import {Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {MapTracker} from "./mapMetrics.js";
import {BlockStateCache} from "./types.js";

const MAX_STATES = 3 * 32;

/**
 * Old implementation of StateCache
 * - Prune per checkpoint so number of states ranges from 96 to 128
 * - Keep a separate head state to make sure it is always available
 */
export class StateContextCache implements BlockStateCache {
  /**
   * Max number of states allowed in the cache
   */
  readonly maxStates: number;

  private readonly cache: MapTracker<string, CachedBeaconStateAllForks>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new Map<Epoch, Set<string>>();
  private readonly metrics: Metrics["stateCache"] | null | undefined;
  /**
   * Strong reference to prevent head state from being pruned.
   * null if head state is being regen and not available at the moment.
   */
  private head: {state: CachedBeaconStateAllForks; stateRoot: RootHex} | null = null;

  constructor({maxStates = MAX_STATES, metrics}: {maxStates?: number; metrics?: Metrics | null}) {
    this.maxStates = maxStates;
    this.cache = new MapTracker(metrics?.stateCache);
    if (metrics) {
      this.metrics = metrics.stateCache;
      metrics.stateCache.size.addCollect(() => metrics.stateCache.size.set(this.cache.size));
    }
  }

  get(rootHex: RootHex): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const item = this.head?.stateRoot === rootHex ? this.head.state : this.cache.get(rootHex);
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
  }

  setHeadState(item: CachedBeaconStateAllForks | null): void {
    if (item) {
      const key = toHexString(item.hashTreeRoot());
      this.head = {state: item, stateRoot: key};
    } else {
      this.head = null;
    }
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * TODO make this more robust.
   * Without more thought, this currently breaks our assumptions about recent state availablity
   */
  prune(headStateRootHex: RootHex): void {
    const keys = Array.from(this.cache.keys());
    if (keys.length > this.maxStates) {
      // object keys are stored in insertion order, delete keys starting from the front
      for (const key of keys.slice(0, keys.length - this.maxStates)) {
        if (key !== headStateRootHex) {
          const item = this.cache.get(key);
          if (item) {
            this.epochIndex.get(item.epochCtx.epoch)?.delete(key);
            this.cache.delete(key);
          }
        }
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
