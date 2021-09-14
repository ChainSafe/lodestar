import {toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, allForks} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {routes} from "@chainsafe/lodestar-api";
import {IMetrics} from "../../metrics";
import {MapTracker} from "./mapMetrics";

const MAX_EPOCHS = 10;

/**
 * In memory cache of CachedBeaconState
 * belonging to checkpoint
 *
 * Similar API to Repository
 */
export class CheckpointStateCache {
  private readonly cache: MapTracker<string, CachedBeaconState<allForks.BeaconState>>;
  /** Epoch -> Set<blockRoot> */
  private readonly epochIndex = new Map<Epoch, Set<string>>();
  private readonly metrics: IMetrics["cpStateCache"] | null | undefined;

  constructor({metrics}: {metrics?: IMetrics | null}) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() => metrics.cpStateCache.size.set(this.cache.size));
      metrics.cpStateCache.epochSize.addCollect(() => metrics.cpStateCache.epochSize.set(this.epochIndex.size));
    }
  }

  get(cp: phase0.Checkpoint): CachedBeaconState<allForks.BeaconState> | null {
    this.metrics?.lookups.inc();
    const item = this.cache.get(toCheckpointKey(cp));
    if (item) this.metrics?.hits.inc();
    return item ? item.clone() : null;
  }

  add(cp: phase0.Checkpoint, item: CachedBeaconState<allForks.BeaconState>): void {
    const key = toCheckpointKey(cp);
    if (this.cache.has(key)) {
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, item.clone());
    const epochKey = toHexString(cp.root);
    const value = this.epochIndex.get(cp.epoch);
    if (value) {
      value.add(epochKey);
    } else {
      this.epochIndex.set(cp.epoch, new Set([epochKey]));
    }
  }

  /**
   * Searches for the latest cached state with a `root`, starting with `epoch` and descending
   */
  getLatest({root, epoch}: phase0.Checkpoint): CachedBeaconState<allForks.BeaconState> | null {
    const hexRoot = toHexString(root);
    // sort epochs in descending order, only consider epochs lte `epoch`
    const epochs = Array.from(this.epochIndex.keys())
      .sort((a, b) => b - a)
      .filter((e) => e <= epoch);
    for (const epoch of epochs) {
      const rootSet = this.epochIndex.get(epoch);
      if (rootSet && rootSet.has(hexRoot)) {
        return this.get({root, epoch});
      }
    }
    return null;
  }

  pruneFinalized(finalizedEpoch: Epoch): void {
    for (const epoch of this.epochIndex.keys()) {
      if (epoch < finalizedEpoch) {
        this.deleteAllEpochItems(epoch);
      }
    }
  }

  prune(finalizedEpoch: Epoch, justifiedEpoch: Epoch): void {
    const epochs = Array.from(this.epochIndex.keys()).filter(
      (epoch) => epoch !== finalizedEpoch && epoch !== justifiedEpoch
    );
    if (epochs.length > MAX_EPOCHS) {
      for (const epoch of epochs.slice(0, epochs.length - MAX_EPOCHS)) {
        this.deleteAllEpochItems(epoch);
      }
    }
  }

  delete(cp: phase0.Checkpoint): void {
    this.cache.delete(toCheckpointKey(cp));
    const epochKey = toHexString(cp.root);
    const value = this.epochIndex.get(cp.epoch);
    if (value) {
      value.delete(epochKey);
      if (value.size === 0) {
        this.epochIndex.delete(cp.epoch);
      }
    }
  }

  deleteAllEpochItems(epoch: Epoch): void {
    for (const hexRoot of this.epochIndex.get(epoch) || []) {
      this.cache.delete(toCheckpointHexKey({root: hexRoot, epoch}));
    }
    this.epochIndex.delete(epoch);
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
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
}

function toCheckpointKey(cp: phase0.Checkpoint): string {
  return `${toHexString(cp.root)}:${cp.epoch}`;
}

function toCheckpointHexKey(cp: {root: string; epoch: Epoch}): string {
  return `${cp.root}:${cp.epoch}`;
}
