import {Epoch, RootHex} from "@lodestar/types";
import {GaugeExtra, LodestarError, MapDef, NoLabels, pruneSetToMax} from "@lodestar/utils";
import {EpochShuffling, computeEpochShuffling} from "../util/index.js";
import {BeaconStateAllForks} from "./types.js";

/**
 * With default chain option of maxSkipSlots = 32, there should be no shuffling promise. If that happens a lot, it could blow up Lodestar,
 * with MAX_EPOCHS = 4, only allow 2 promise at a time. Note that regen already bounds number of concurrent requests at 1 already.
 */
export const SHUFFLING_CACHE_MAX_PROMISES = 2;

/**
 * Same value to CheckpointBalancesCache, with the assumption that we don't have to use it for old epochs. In the worse case:
 * - when loading state bytes from disk, we need to compute shuffling for all epochs (~1s as of Sep 2023)
 * - don't have shuffling to verify attestations, need to do 1 epoch transition to add shuffling to this cache. This never happens
 * with default chain option of maxSkipSlots = 32
 **/
export const SHUFFLING_CACHE_MAX_EPOCHS = 4;

export enum ShufflingCacheCaller {
  testing = "testing",
  buildShuffling = "buildShuffling",
  synchronousBuildShuffling = "synchronousBuildShuffling",
  attestationVerification = "attestationVerification",
  createFromState = "createFromState",
  reloadCreateFromState = "reloadCreateFromState",
  getBeaconCommittee = "getBeaconCommittee",
  getEpochCommittees = "getEpochCommittees",
  getAttestationsForBlock = "getAttestationsForBlock",
  getCommitteeCountPerSlot = "getCommitteeCountPerSlot",
  getCommitteeAssignments = "getCommitteeAssignments",
}

export interface ShufflingCacheMetrics {
  shufflingCache: {
    size: GaugeExtra<NoLabels>;
    cacheMiss: GaugeExtra<{caller: ShufflingCacheCaller}>;
    cacheMissUnresolvedPromise: GaugeExtra<{caller: ShufflingCacheCaller}>;
    cacheHit: GaugeExtra<{caller: ShufflingCacheCaller}>;
    cacheHitUnresolvedPromise: GaugeExtra<{caller: ShufflingCacheCaller}>;
    cacheHitRebuildPromise: GaugeExtra<NoLabels>;
  };
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

export type ShufflingResolution = (shuffling: EpochShuffling) => void;

export interface ShufflingCacheOptions {
  maxShufflingCacheEpochs?: number;
}

/**
 * A shuffling cache to help:
 * - get committee quickly for attestation verification
 * - if a shuffling is not available (which does not happen with default chain option of maxSkipSlots = 32), track a promise to make sure we don't compute the same shuffling twice
 * - skip computing shuffling when loading state bytes from disk
 */
export class ShufflingCache {
  /** LRU cache implemented as a map, pruned every time we add an item */
  private readonly itemsByDecisionRootByEpoch: MapDef<Epoch, Map<RootHex, ShufflingCacheItem>> = new MapDef(
    () => new Map<RootHex, ShufflingCacheItem>()
  );
  private readonly maxEpochs: number;
  private metrics: ShufflingCacheMetrics | null = null;

  constructor(metrics: ShufflingCacheMetrics | null = null, opts: ShufflingCacheOptions = {}) {
    this.maxEpochs = opts.maxShufflingCacheEpochs ?? SHUFFLING_CACHE_MAX_EPOCHS;
    this.addMetrics(metrics);
    // just used for testing and don't want to pollute the public api
    Object.defineProperty(this, "allAsArray", {
      enumerable: false,
      value: () =>
        Array.from(this.itemsByDecisionRootByEpoch.values()).flatMap((innerMap) => Array.from(innerMap.values())),
    });
  }

  addMetrics(metrics: ShufflingCacheMetrics | null): void {
    if (!this.metrics) {
      this.metrics = metrics;
      if (metrics) {
        metrics.shufflingCache.size.addCollect(() =>
          metrics.shufflingCache.size.set(
            Array.from(this.itemsByDecisionRootByEpoch.values()).reduce((total, innerMap) => total + innerMap.size, 0)
          )
        );
      }
    }
  }

  /**
   * Used for attestation verifications.  Will immediately return a shuffling if it is available,
   * otherwise it will return the promise for the shuffling and the consumer will need to wait for
   * it to be calculated.  Consumer await covers both cases.  If shuffling is not available returns
   * null and does not attempt to compute shuffling.
   */
  async get(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): Promise<EpochShuffling | null> {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined) {
      this.metrics?.shufflingCache.cacheMiss.inc({caller: ShufflingCacheCaller.attestationVerification});
      return null;
    }
    if (this.isShufflingCacheItem(cacheItem)) {
      this.metrics?.shufflingCache.cacheHit.inc({
        caller: ShufflingCacheCaller.attestationVerification,
      });
      return cacheItem.shuffling;
    } else {
      this.metrics?.shufflingCache.cacheHitUnresolvedPromise.inc({
        caller: ShufflingCacheCaller.attestationVerification,
      });
      return cacheItem.promise;
    }
  }

  /**
   * Will synchronously get a shuffling if it is available or will throw an error if not. Metrics are collected
   * by this._get
   */
  getOrError(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex, caller: ShufflingCacheCaller): EpochShuffling {
    // Will throw for error case so always returns a value
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this._get(shufflingEpoch, shufflingDecisionRoot, true, caller)!;
  }

  /**
   * Will synchronously get a shuffling if it is available or will return null if not. The consumer
   * will have to then submit for building the shuffling. Metrics are collected by this._get
   */
  getOrNull(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex, isReload = false): EpochShuffling | null {
    return this._get(
      shufflingEpoch,
      shufflingDecisionRoot,
      false,
      isReload ? ShufflingCacheCaller.reloadCreateFromState : ShufflingCacheCaller.createFromState
    );
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
      if (this.isShufflingCacheItem(cacheItem)) {
        this.metrics?.shufflingCache.cacheHit.inc({caller: ShufflingCacheCaller.synchronousBuildShuffling});
        return cacheItem.shuffling;
      }
      // Add metric here for race condition recreating the shuffling because
      // this sync call will finish first if its running on thread
      //
      // TODO: (matthewkeil) Perhaps we should throw an error instead. Should not happen ideally
      this.metrics?.shufflingCache.cacheHitRebuildPromise.inc();
      // add log statement here with epoch and decision root for this miss
      resolveFn = cacheItem.resolveFn;
    } else {
      resolveFn = this._insertShufflingPromise(shufflingEpoch, shufflingDecisionRoot);
      this.metrics?.shufflingCache.cacheMiss.inc({caller: ShufflingCacheCaller.synchronousBuildShuffling});
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
      if (this.isShufflingCacheItem(cacheItem)) {
        this.metrics?.shufflingCache.cacheHit.inc({caller: ShufflingCacheCaller.buildShuffling});
        return cacheItem.shuffling;
      }
      this.metrics?.shufflingCache.cacheHitUnresolvedPromise.inc({caller: ShufflingCacheCaller.buildShuffling});
      return cacheItem.promise;
    }

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

  private _get(
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    shouldError: boolean,
    caller: ShufflingCacheCaller
  ): EpochShuffling | null {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined) {
      this.metrics?.shufflingCache.cacheMiss.inc({caller});
      if (shouldError) {
        throw new ShufflingCacheError({
          code: ShufflingCacheErrorCode.NO_SHUFFLING_FOUND,
          epoch: shufflingEpoch,
          shufflingDecisionRoot,
        });
      }
      return null;
    }
    if (this.isPromiseCacheItem(cacheItem)) {
      this.metrics?.shufflingCache.cacheMissUnresolvedPromise.inc({caller});
      if (shouldError) {
        throw new ShufflingCacheError({
          code: ShufflingCacheErrorCode.SHUFFLING_PROMISE_NOT_RESOLVED,
          epoch: shufflingEpoch,
          shufflingDecisionRoot,
        });
      }
      return null;
    }
    this.metrics?.shufflingCache.cacheHit.inc({caller});
    return cacheItem.shuffling;
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
    if (promiseCount >= SHUFFLING_CACHE_MAX_PROMISES) {
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
