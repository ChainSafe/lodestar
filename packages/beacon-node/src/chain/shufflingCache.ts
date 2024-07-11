import {BeaconStateAllForks, EpochShuffling, IShufflingCache, computeEpochShuffling} from "@lodestar/state-transition";
import {Epoch, RootHex} from "@lodestar/types";
import {LodestarError, MapDef, pruneSetToMax} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";

/**
 * Same value to CheckpointBalancesCache, with the assumption that we don't have to use it for old epochs. In the worse case:
 * - when loading state bytes from disk, we need to compute shuffling for all epochs (~1s as of Sep 2023)
 * - don't have shuffling to verify attestations, need to do 1 epoch transition to add shuffling to this cache. This never happens
 * with default chain option of maxSkipSlots = 32
 **/
const MAX_EPOCHS = 4;

/**
 * With default chain option of maxSkipSlots = 32, there should be no shuffling promise. If that happens a lot, it could blow up Lodestar,
 * with MAX_EPOCHS = 4, only allow 2 promise at a time. Note that regen already bounds number of concurrent requests at 1 already.
 */
const MAX_PROMISES = 2;

enum CacheItemType {
  shuffling,
  promise,
}

type ShufflingCacheItem = {
  type: CacheItemType.shuffling;
  shuffling: EpochShuffling;
};

type PromiseCacheItem = {
  type: CacheItemType.promise;
  promise: Promise<EpochShuffling>;
  resolveFn: (shuffling: EpochShuffling) => void;
};

type CacheItem = ShufflingCacheItem | PromiseCacheItem;

export type ShufflingCacheOpts = {
  maxShufflingCacheEpochs?: number;
};

/**
 * A shuffling cache to help:
 * - get committee quickly for attestation verification
 * - if a shuffling is not available (which does not happen with default chain option of maxSkipSlots = 32), track a promise to make sure we don't compute the same shuffling twice
 * - skip computing shuffling when loading state bytes from disk
 */
export class ShufflingCache implements IShufflingCache {
  /** LRU cache implemented as a map, pruned every time we add an item */
  private readonly itemsByDecisionRootByEpoch: MapDef<Epoch, Map<RootHex, CacheItem>> = new MapDef(
    () => new Map<RootHex, CacheItem>()
  );

  private readonly maxEpochs: number;

  constructor(
    private readonly metrics: Metrics | null = null,
    opts: ShufflingCacheOpts = {}
  ) {
    if (metrics) {
      metrics.shufflingCache.size.addCollect(() =>
        metrics.shufflingCache.size.set(
          Array.from(this.itemsByDecisionRootByEpoch.values()).reduce((total, innerMap) => total + innerMap.size, 0)
        )
      );
    }

    this.maxEpochs = opts.maxShufflingCacheEpochs ?? MAX_EPOCHS;
  }

  /**
   * Insert a promise to make sure we don't regen state for the same shuffling.
   * Bound by MAX_SHUFFLING_PROMISE to make sure our node does not blow up.
   */
  insertPromise(epoch: Epoch, decisionRoot: RootHex): void {
    const promiseCount = Array.from(this.itemsByDecisionRootByEpoch.values())
      .flatMap((innerMap) => Array.from(innerMap.values()))
      .filter((item) => isPromiseCacheItem(item)).length;
    if (promiseCount >= MAX_PROMISES) {
      throw new Error(
        `Too many shuffling promises: ${promiseCount}, shufflingEpoch: ${epoch}, decisionRootHex: ${decisionRoot}`
      );
    }
    let resolveFn: ((shuffling: EpochShuffling) => void) | null = null;
    const promise = new Promise<EpochShuffling>((resolve) => {
      resolveFn = resolve;
    });
    if (resolveFn === null) {
      throw new Error("Promise Constructor was not executed immediately");
    }

    const cacheItem: PromiseCacheItem = {
      type: CacheItemType.promise,
      promise,
      resolveFn,
    };
    this.itemsByDecisionRootByEpoch.getOrDefault(epoch).set(decisionRoot, cacheItem);
    this.metrics?.shufflingCache.insertPromiseCount.inc();
  }

  /**
   * Most of the time, this should return a shuffling immediately.
   * If there's a promise, it means we are computing the same shuffling, so we wait for the promise to resolve.
   * Return null if we don't have a shuffling for this epoch and dependentRootHex.
   */
  async get(epoch: Epoch, decisionRoot: RootHex): Promise<EpochShuffling | null> {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(epoch).get(decisionRoot);
    if (cacheItem === undefined) {
      // this.metrics?.shufflingCache.miss();
      return null;
    }

    if (isShufflingCacheItem(cacheItem)) {
      return cacheItem.shuffling;
    } else {
      return cacheItem.promise;
    }
  }

  /**
   * Will synchronously get a shuffling if it is available or will return null if not.
   */
  getSync(epoch: Epoch, decisionRoot: RootHex): EpochShuffling | null {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(epoch).get(decisionRoot);
    if (cacheItem) {
      if (isShufflingCacheItem(cacheItem)) {
        // this.metrics?.shufflingCache.hit()
        return cacheItem.shuffling;
      }
      //   this.metrics?.shufflingCache.shufflingPromiseNotResolved();
    }
    // this.metrics?.shufflingCache.miss();
    return null;
  }

  /**
   * Gets a cached shuffling via the epoch and decision root.  If the shuffling is not
   * available it will build it synchronously and return the shuffling.
   *
   * NOTE: If a shuffling is already queued and not calculated it will build and resolve
   * the promise but the already queued build will happen at some later time
   */
  getOrBuildSync(
    epoch: number,
    decisionRoot: string,
    state: BeaconStateAllForks,
    activeIndices: number[]
  ): EpochShuffling {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(epoch).get(decisionRoot);
    if (cacheItem && isShufflingCacheItem(cacheItem)) {
      // this.metrics?.shufflingCache.cacheHitEpochTransition();
      return cacheItem.shuffling;
    }
    const shuffling = computeEpochShuffling(state, activeIndices, epoch);
    if (cacheItem) {
      // this.metrics?.shufflingCache.shufflingPromiseNotResolvedEpochTransition();
      cacheItem.resolveFn(shuffling);
    } else {
      // this.metrics?.shufflingCache.cacheMissEpochTransition();
    }
    this.set(shuffling, decisionRoot);
    return shuffling;
  }

  /**
   * Queue asynchronous build for an EpochShuffling
   */
  build(epoch: number, decisionRoot: string, state: BeaconStateAllForks, activeIndices: number[]): void {
    this.insertPromise(epoch, decisionRoot);
    /**
     * TODO: (@matthewkeil) This will get replaced by a proper build queue and a worker to do calculations
     * on a NICE thread with a rust implementation
     */
    setTimeout(() => {
      const shuffling = computeEpochShuffling(state, activeIndices, epoch);
      this.set(shuffling, decisionRoot);
      // wait until after the first slot to help with attestation and block proposal performance
    }, 12_000);
  }

  /**
   * Add an EpochShuffling to the ShufflingCache. If a promise for the shuffling is present it will
   * resolve the promise with the built shuffling
   */
  set(shuffling: EpochShuffling, decisionRoot: string): void {
    const items = this.itemsByDecisionRootByEpoch.getOrDefault(shuffling.epoch);
    // if a pending shuffling promise exists, resolve it
    const item = items.get(decisionRoot);
    if (item) {
      if (isPromiseCacheItem(item)) {
        item.resolveFn(shuffling);
      } else {
        // metric for throwing away previously calculated shuffling
      }
    }
    // set the shuffling
    items.set(decisionRoot, {type: CacheItemType.shuffling, shuffling});
    // prune the cache
    pruneSetToMax(this.itemsByDecisionRootByEpoch, this.maxEpochs);
  }
}

function isShufflingCacheItem(item: CacheItem): item is ShufflingCacheItem {
  return item.type === CacheItemType.shuffling;
}

function isPromiseCacheItem(item: CacheItem): item is PromiseCacheItem {
  return item.type === CacheItemType.promise;
}

export enum ShufflingCacheErrorCode {
  NO_SHUFFLING_FOUND = "SHUFFLING_CACHE_ERROR_NO_SHUFFLING_FOUND",
}

type ShufflingCacheErrorType = {
  code: ShufflingCacheErrorCode.NO_SHUFFLING_FOUND;
  epoch: Epoch;
  decisionRoot: RootHex;
};

export class ShufflingCacheError extends LodestarError<ShufflingCacheErrorType> {}
