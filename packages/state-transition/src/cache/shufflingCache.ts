import {Epoch, RootHex} from "@lodestar/types";
import type {Metrics} from "@lodestar/beacon-node";
import {LodestarError, MapDef, pruneSetToMax} from "@lodestar/utils";
import {EpochShuffling, computeEpochShuffling} from "../util/index.js";
import {BeaconStateAllForks} from "./types.js";

/**
 * With default chain option of maxSkipSlots = 32, there should be no shuffling promise. If that happens a lot, it could blow up Lodestar,
 * with MAX_EPOCHS = 4, only allow 2 promise at a time. Note that regen already bounds number of concurrent requests at 1 already.
 */
const MAX_PROMISES = 2;

/**
 * Same value to CheckpointBalancesCache, with the assumption that we don't have to use it for old epochs. In the worse case:
 * - when loading state bytes from disk, we need to compute shuffling for all epochs (~1s as of Sep 2023)
 * - don't have shuffling to verify attestations, need to do 1 epoch transition to add shuffling to this cache. This never happens
 * with default chain option of maxSkipSlots = 32
 **/
const SHUFFLING_CACHE_MAX_EPOCHS = 4;

export interface IShufflingCache {
  add(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex, shuffling: EpochShuffling): void;
  get(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): Promise<EpochShuffling | null>;
  // getAll(): MapDef<Epoch, Map<RootHex, ShufflingCacheItem>>;
  getOrNull(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): EpochShuffling | null;
  getOrError(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): EpochShuffling;
  buildSync(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): EpochShuffling;
  build(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): Promise<EpochShuffling>;
}

export enum ShufflingCacheErrorCode {
  NO_SHUFFLING_FOUND = "EPOCH_SHUFFLING_NO_SHUFFLING_FOUND",
  REGEN_ERROR_NO_SHUFFLING_FOUND = "REGEN_ERROR_NO_SHUFFLING_FOUND",
  SHUFFLING_PROMISE_NOT_RESOLVED = "EPOCH_SHUFFLING_SHUFFLING_PROMISE_NOT_RESOLVED",
}

type ShufflingCacheErrorType =
  | {code: ShufflingCacheErrorCode.NO_SHUFFLING_FOUND; epoch: Epoch; shufflingDecisionRoot: RootHex}
  | {code: ShufflingCacheErrorCode.REGEN_ERROR_NO_SHUFFLING_FOUND; epoch: Epoch; shufflingDecisionRoot: RootHex}
  | {code: ShufflingCacheErrorCode.SHUFFLING_PROMISE_NOT_RESOLVED; epoch: Epoch; shufflingDecisionRoot: RootHex};

export class ShufflingCacheError extends LodestarError<ShufflingCacheErrorType> {}

export enum ShufflingCacheItemType {
  shuffling,
  promise,
}

export type ShufflingCacheShufflingItem = {
  type: ShufflingCacheItemType.shuffling;
  shuffling: EpochShuffling;
};

export type ShufflingCachePromiseItem = {
  type: ShufflingCacheItemType.promise;
  promise: Promise<EpochShuffling>;
  resolveFn: (shuffling: EpochShuffling) => void;
};

export type ShufflingCacheItem = ShufflingCacheShufflingItem | ShufflingCachePromiseItem;

type ShufflingResolution = (shuffling: EpochShuffling) => void;

export interface ShufflingCacheOptions {
  maxShufflingCacheEpochs?: number;
}

/**
 * A shuffling cache to help:
 * - get committee quickly for attestation verification
 * - if a shuffling is not available (which does not happen with default chain option of maxSkipSlots = 32), track a promise to make sure we don't compute the same shuffling twice
 * - skip computing shuffling when loading state bytes from disk
 */
export class ShufflingCache implements IShufflingCache {
  /** LRU cache implemented as a map, pruned every time we add an item */
  private readonly itemsByDecisionRootByEpoch: MapDef<Epoch, Map<RootHex, ShufflingCacheItem>> = new MapDef(
    () => new Map<RootHex, ShufflingCacheItem>()
  );
  private readonly maxEpochs: number;

  constructor(
    private metrics: Metrics | null = null,
    opts: ShufflingCacheOptions = {}
  ) {
    this.maxEpochs = opts.maxShufflingCacheEpochs ?? SHUFFLING_CACHE_MAX_EPOCHS;
    if (metrics) {
      metrics.shufflingCache.size.addCollect(() =>
        metrics.shufflingCache.size.set(
          Array.from(this.itemsByDecisionRootByEpoch.values()).reduce((total, innerMap) => total + innerMap.size, 0)
        )
      );
    }
  }

  addMetrics(metrics: Metrics): void {
    this.metrics = metrics;
  }

  async get(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): Promise<EpochShuffling | null> {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined) {
      return null;
    }
    if (this.isShufflingCacheItem(cacheItem)) {
      return cacheItem.shuffling;
    } else {
      return cacheItem.promise;
    }
  }

  getOrError(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): EpochShuffling {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined) {
      throw new ShufflingCacheError({
        code: ShufflingCacheErrorCode.NO_SHUFFLING_FOUND,
        epoch: shufflingEpoch,
        shufflingDecisionRoot,
      });
    }
    if (this.isPromiseCacheItem(cacheItem)) {
      throw new ShufflingCacheError({
        code: ShufflingCacheErrorCode.SHUFFLING_PROMISE_NOT_RESOLVED,
        epoch: shufflingEpoch,
        shufflingDecisionRoot,
      });
    }
    return cacheItem.shuffling;
  }

  getOrNull(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): EpochShuffling | null {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined || this.isPromiseCacheItem(cacheItem)) {
      return null;
    }
    return cacheItem.shuffling;
  }

  add(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex, shuffling: EpochShuffling): void {
    this.itemsByDecisionRootByEpoch
      .getOrDefault(shufflingEpoch)
      .set(shufflingDecisionRoot, {type: ShufflingCacheItemType.shuffling, shuffling});
    pruneSetToMax(this.itemsByDecisionRootByEpoch, this.maxEpochs);
  }

  buildSync(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): EpochShuffling {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    let resolveFn: ShufflingResolution;
    if (cacheItem) {
      // TODO: (matthewkeil) Add metric here for cache hit
      if (this.isShufflingCacheItem(cacheItem)) {
        return cacheItem.shuffling;
      }
      // Perhaps we should throw an error instead. Should not happen ideally
      //
      // TODO: (matthewkeil) Add metric here for race condition recreating the shuffling
      //       because this sync call will finish first if its running on thread
      resolveFn = cacheItem.resolveFn;
    } else {
      // TODO: (matthewkeil) Add metric here for cache miss
      resolveFn = this._insertShufflingPromise(shufflingEpoch, shufflingDecisionRoot);
    }

    const shuffling = this._build(state, shufflingEpoch, shufflingDecisionRoot, activeIndexes);
    resolveFn(shuffling);
    return shuffling;
  }

  async build(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): Promise<EpochShuffling> {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem) {
      // TODO: (matthewkeil) Add metric here for cache hit
      if (this.isShufflingCacheItem(cacheItem)) {
        return cacheItem.shuffling;
      }
      return cacheItem.promise;
    }

    // TODO: (matthewkeil) Add metric here for cache miss
    //
    // this is to prevent multiple calls to get shuffling for the same epoch and dependent root
    // any subsequent calls of the same epoch and dependent root will wait for this promise to resolve
    const resolveFn = this._insertShufflingPromise(shufflingEpoch, shufflingDecisionRoot);
    // TODO: (matthewkeil) replace this sync call with a worker and async build function that uses
    //       a nice'd thread to build in core idle time
    //
    // Building will overwrite the ShufflingCachePromiseItem with the ShufflingCacheShufflingItem
    const shuffling = this._build(state, shufflingEpoch, shufflingDecisionRoot, activeIndexes);
    resolveFn(shuffling);
    return shuffling;
  }

  private _build(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): EpochShuffling {
    const shuffling = computeEpochShuffling(state, activeIndexes, shufflingEpoch);
    this.add(shufflingEpoch, shufflingDecisionRoot, shuffling);
    return shuffling;
  }

  private _insertShufflingPromise(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): ShufflingResolution {
    const promiseCount = Array.from(this.itemsByDecisionRootByEpoch.values())
      .flatMap((innerMap) => Array.from(innerMap.values()))
      .filter((item) => this.isPromiseCacheItem(item)).length;
    if (promiseCount >= MAX_PROMISES) {
      throw new Error(
        `Too many shuffling promises: ${promiseCount}, shufflingEpoch: ${shufflingEpoch}, shufflingDecisionRoot: ${shufflingDecisionRoot}`
      );
    }
    let resolveFn!: ShufflingResolution;
    const promise = new Promise<EpochShuffling>((resolve) => {
      resolveFn = resolve;
    });
    this.itemsByDecisionRootByEpoch
      .getOrDefault(shufflingEpoch)
      .set(shufflingDecisionRoot, {type: ShufflingCacheItemType.promise, promise, resolveFn});
    return resolveFn;
  }

  private isShufflingCacheItem(item: ShufflingCacheItem): item is ShufflingCacheShufflingItem {
    return item.type === ShufflingCacheItemType.shuffling;
  }

  private isPromiseCacheItem(item: ShufflingCacheItem): item is ShufflingCachePromiseItem {
    return item.type === ShufflingCacheItemType.promise;
  }
}
