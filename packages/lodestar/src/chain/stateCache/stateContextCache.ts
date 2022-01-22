import {ByteVector, toHexString} from "@chainsafe/ssz";
import {Epoch, RootHex} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {routes} from "@chainsafe/lodestar-api";
import {IMetrics} from "../../metrics";
import {MapTracker} from "./mapMetrics";

const MAX_STATES = 3 * 32;

/**
 * In memory cache of CachedBeaconState
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
  private readonly metrics: IMetrics["stateCache"] | null | undefined;

  constructor({maxStates = MAX_STATES, metrics}: {maxStates?: number; metrics?: IMetrics | null}) {
    this.maxStates = maxStates;
    this.cache = new MapTracker(metrics?.stateCache);
    if (metrics) {
      this.metrics = metrics.stateCache;
      metrics.stateCache.size.addCollect(() => metrics.stateCache.size.set(this.cache.size));
    }
  }

  get(rootHex: RootHex): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const item = this.cache.get(rootHex);
    if (!item) {
      return null;
    }
    this.metrics?.hits.inc();
    return item.clone();
  }

  add(item: CachedBeaconStateAllForks): void {
    const key = toHexString(item.hashTreeRoot());
    if (this.cache.get(key)) {
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, item.clone());
    const epoch = item.epochCtx.currentShuffling.epoch;
    const blockRoots = this.epochIndex.get(epoch);
    if (blockRoots) {
      blockRoots.add(key);
    } else {
      this.epochIndex.set(epoch, new Set([key]));
    }
  }

  delete(root: ByteVector): void {
    const key = toHexString(root);
    const item = this.cache.get(key);
    if (!item) return;
    this.epochIndex.get(item.epochCtx.currentShuffling.epoch)?.delete(key);
    this.cache.delete(key);
  }

  batchDelete(roots: ByteVector[]): void {
    roots.map((root) => this.delete(root));
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
            this.epochIndex.get(item.epochCtx.currentShuffling.epoch)?.delete(key);
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
    }));
  }

  private deleteAllEpochItems(epoch: Epoch): void {
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      this.cache.delete(rootHex);
    }
    this.epochIndex.delete(epoch);
  }
}
