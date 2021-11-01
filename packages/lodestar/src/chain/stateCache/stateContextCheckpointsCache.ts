import {toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, allForks, RootHex} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {routes} from "@chainsafe/lodestar-api";
import {IMetrics} from "../../metrics";
import {MapTracker} from "./mapMetrics";
import {MapDef} from "../../util/map";

type CheckpointHex = {epoch: Epoch; rootHex: RootHex};
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
  private readonly epochIndex = new MapDef<Epoch, Set<string>>(() => new Set<string>());
  private readonly metrics: IMetrics["cpStateCache"] | null | undefined;
  private preComputedCheckpoint: string | null = null;
  private preComputedCheckpointHits: number | null = null;

  constructor({metrics}: {metrics?: IMetrics | null}) {
    this.cache = new MapTracker(metrics?.cpStateCache);
    if (metrics) {
      this.metrics = metrics.cpStateCache;
      metrics.cpStateCache.size.addCollect(() => metrics.cpStateCache.size.set(this.cache.size));
      metrics.cpStateCache.epochSize.addCollect(() => metrics.cpStateCache.epochSize.set(this.epochIndex.size));
    }
  }

  get(cp: CheckpointHex): CachedBeaconState<allForks.BeaconState> | null {
    this.metrics?.lookups.inc();
    const cpKey = toCheckpointKey(cp);
    const item = this.cache.get(cpKey);
    if (item) {
      this.metrics?.hits.inc();
      if (cpKey === this.preComputedCheckpoint) {
        this.preComputedCheckpointHits = (this.preComputedCheckpointHits ?? 0) + 1;
      }
    }
    return item ? item.clone() : null;
  }

  add(cp: phase0.Checkpoint, item: CachedBeaconState<allForks.BeaconState>): void {
    const cpHex = toCheckpointHex(cp);
    const key = toCheckpointKey(cpHex);
    if (this.cache.has(key)) {
      return;
    }
    this.metrics?.adds.inc();
    this.cache.set(key, item.clone());
    this.epochIndex.getOrDefault(cp.epoch).add(cpHex.rootHex);
  }

  /**
   * Searches for the latest cached state with a `root`, starting with `epoch` and descending
   */
  getLatest(rootHex: RootHex, maxEpoch: Epoch): CachedBeaconState<allForks.BeaconState> | null {
    // sort epochs in descending order, only consider epochs lte `epoch`
    const epochs = Array.from(this.epochIndex.keys())
      .sort((a, b) => b - a)
      .filter((e) => e <= maxEpoch);
    for (const epoch of epochs) {
      if (this.epochIndex.get(epoch)?.has(rootHex)) {
        return this.get({rootHex, epoch});
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
    this.cache.delete(toCheckpointKey(toCheckpointHex(cp)));
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
    for (const rootHex of this.epochIndex.get(epoch) || []) {
      this.cache.delete(toCheckpointKey({rootHex, epoch}));
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

export function toCheckpointHex(checkpoint: phase0.Checkpoint): CheckpointHex {
  return {
    epoch: checkpoint.epoch,
    rootHex: toHexString(checkpoint.root),
  };
}

function toCheckpointKey(cp: CheckpointHex): string {
  return `${cp.rootHex}:${cp.epoch}`;
}
