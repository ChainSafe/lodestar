import {toHexString, fromHexString} from "@chainsafe/ssz";
import {phase0, Epoch, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

const MAX_EPOCHS = 10;

/**
 * In memory cache of CachedBeaconState
 * belonging to checkpoint
 *
 * Similar API to Repository
 */
export class CheckpointStateCache {
  private readonly config: IBeaconConfig;
  private cache = new Map<string, CachedBeaconState<allForks.BeaconState>>();
  /** Epoch -> Set<blockRoot> */
  private epochIndex = new Map<Epoch, Set<string>>();

  constructor(config: IBeaconConfig) {
    this.config = config;
  }

  get(cp: phase0.Checkpoint): CachedBeaconState<allForks.BeaconState> | null {
    const item = this.cache.get(toHexString(this.config.types.phase0.Checkpoint.hashTreeRoot(cp)));
    return item ? item.clone() : null;
  }

  add(cp: phase0.Checkpoint, item: CachedBeaconState<allForks.BeaconState>): void {
    const key = toHexString(this.config.types.phase0.Checkpoint.hashTreeRoot(cp));
    if (this.cache.has(key)) {
      return;
    }
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
    const key = toHexString(this.config.types.phase0.Checkpoint.hashTreeRoot(cp));
    this.cache.delete(key);
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
      this.cache.delete(
        toHexString(this.config.types.phase0.Checkpoint.hashTreeRoot({root: fromHexString(hexRoot), epoch}))
      );
    }
    this.epochIndex.delete(epoch);
  }

  clear(): void {
    this.cache.clear();
    this.epochIndex.clear();
  }
}
