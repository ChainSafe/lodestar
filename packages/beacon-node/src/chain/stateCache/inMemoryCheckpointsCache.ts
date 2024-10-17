import {phase0, Epoch, RootHex} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {MapDef, toRootHex} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {Metrics} from "../../metrics/index.js";
import {StateCloneOpts} from "../regen/interface.js";
import {MapTracker} from "./mapMetrics.js";
import {CheckpointStateCache, CacheItemType} from "./types.js";

export type CheckpointHex = {epoch: Epoch; rootHex: RootHex};
const MAX_EPOCHS = 10;

/**
 * In memory cache of CachedBeaconState
 * belonging to checkpoint
 *
 * Similar API to Repository
 */
export class InMemoryCheckpointStateCache implements CheckpointStateCache {
  private readonly cache: MapTracker<string, CachedBeaconStateAllForks>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new MapDef<Epoch, Set<string>>(() => new Set<string>());
  /**
   * Max number of epochs allowed in the cache
   */
  private readonly maxEpochs: number;
  private readonly metrics: Metrics["cpStateCache"] | null | undefined;
  private preComputedCheckpoint: string | null = null;
  private preComputedCheckpointHits: number | null = null;

  constructor({metrics = null}: {metrics?: Metrics | null}, {maxEpochs = MAX_EPOCHS}: {maxEpochs?: number} = {}) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() =>
        metrics.cpStateCache.size.set({type: CacheItemType.inMemory}, this.cache.size)
      );
      metrics.cpStateCache.epochSize.addCollect(() =>
        metrics.cpStateCache.epochSize.set({type: CacheItemType.inMemory}, this.epochIndex.size)
      );
    }
    this.maxEpochs = maxEpochs;
  }

  async getOrReload(cp: CheckpointHex, opts?: StateCloneOpts): Promise<CachedBeaconStateAllForks | null> {
    return this.get(cp, opts);
  }

  async getStateOrBytes(cp: CheckpointHex): Promise<Uint8Array | CachedBeaconStateAllForks | null> {
    // no need to transfer cache for this api
    return this.get(cp, {dontTransferCache: true});
  }

  async getOrReloadLatest(
    rootHex: string,
    maxEpoch: number,
    opts?: StateCloneOpts
  ): Promise<CachedBeaconStateAllForks | null> {
    return this.getLatest(rootHex, maxEpoch, opts);
  }

  async processState(): Promise<Map<Epoch, CachedBeaconStateAllForks[]> | null> {
    // do nothing, this class does not support prunning
    return null;
  }

  get(cp: CheckpointHex, opts?: StateCloneOpts): CachedBeaconStateAllForks | null {
    this.metrics?.lookups.inc();
    const cpKey = toCheckpointKey(cp);
    const item = this.cache.get(cpKey);

    if (!item) {
      return null;
    }

    this.metrics?.hits.inc();

    if (cpKey === this.preComputedCheckpoint) {
      this.preComputedCheckpointHits = (this.preComputedCheckpointHits ?? 0) + 1;
    }

    this.metrics?.stateClonedCount.observe(item.clonedCount);

    return item.clone(opts?.dontTransferCache);
  }

  add(cp: phase0.Checkpoint, item: CachedBeaconStateAllForks): void {
    const cpHex = toCheckpointHex(cp);
    const key = toCheckpointKey(cpHex);
    if (this.cache.has(key)) {
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, item);
    this.epochIndex.getOrDefault(cp.epoch).add(cpHex.rootHex);
  }

  /**
   * Searches for the latest cached state with a `root`, starting with `epoch` and descending
   */
  getLatest(rootHex: RootHex, maxEpoch: Epoch, opts?: StateCloneOpts): CachedBeaconStateAllForks | null {
    // sort epochs in descending order, only consider epochs lte `epoch`
    const epochs = Array.from(this.epochIndex.keys())
      .sort((a, b) => b - a)
      .filter((e) => e <= maxEpoch);
    for (const epoch of epochs) {
      if (this.epochIndex.get(epoch)?.has(rootHex)) {
        return this.get({rootHex, epoch}, opts);
      }
    }
    return null;
  }

  /**
   * Update the precomputed checkpoint and return the number of his for the
   * previous one (if any).
   */
  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null {
    const previousHits = this.preComputedCheckpointHits;
    this.preComputedCheckpoint = toCheckpointKey({rootHex, epoch});
    this.preComputedCheckpointHits = 0;
    return previousHits;
  }

  async pruneFinalized(finalizedEpoch: Epoch): Promise<Map<Epoch, CachedBeaconStateAllForks[]>> {
    const result = new Map<Epoch, CachedBeaconStateAllForks[]>();

    for (const epoch of this.epochIndex.keys()) {
      if (epoch < finalizedEpoch) {
        const deletedStates = this.deleteAllEpochItems(epoch);
        result.set(epoch, deletedStates);
      }
    }

    return result;
  }

  prune(finalizedEpoch: Epoch, justifiedEpoch: Epoch): void {
    const epochs = Array.from(this.epochIndex.keys()).filter(
      (epoch) => epoch !== finalizedEpoch && epoch !== justifiedEpoch
    );
    if (epochs.length > this.maxEpochs) {
      for (const epoch of epochs.slice(0, epochs.length - this.maxEpochs)) {
        this.deleteAllEpochItems(epoch);
      }
    }
  }

  delete(cp: phase0.Checkpoint): void {
    this.cache.delete(toCheckpointKey(toCheckpointHex(cp)));
    const epochKey = toRootHex(cp.root);
    const value = this.epochIndex.get(cp.epoch);
    if (value) {
      value.delete(epochKey);
      if (value.size === 0) {
        this.epochIndex.delete(cp.epoch);
      }
    }
  }

  deleteAllEpochItems(epoch: Epoch): CachedBeaconStateAllForks[] {
    const states = [];
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      const key = toCheckpointKey({rootHex, epoch});
      const state = this.cache.get(key);
      if (state) {
        states.push(state);
      }
      this.cache.delete(key);
    }
    this.epochIndex.delete(epoch);

    return states;
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }

  /** ONLY FOR DEBUGGING PURPOSES. For lodestar debug API */
  dumpSummary(): routes.lodestar.StateCacheItem[] {
    return Array.from(this.cache.entries()).map(([key, state]) => ({
      slot: state.slot,
      root: toRootHex(state.hashTreeRoot()),
      reads: this.cache.readCount.get(key) ?? 0,
      lastRead: this.cache.lastRead.get(key) ?? 0,
      checkpointState: true,
    }));
  }

  getStates(): IterableIterator<CachedBeaconStateAllForks> {
    return this.cache.values();
  }

  /** ONLY FOR DEBUGGING PURPOSES. For spec tests on error */
  dumpCheckpointKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

export function toCheckpointHex(checkpoint: phase0.Checkpoint): CheckpointHex {
  return {
    epoch: checkpoint.epoch,
    rootHex: toRootHex(checkpoint.root),
  };
}

export function toCheckpointKey(cp: CheckpointHex): string {
  return `${cp.rootHex}:${cp.epoch}`;
}
