import {Epoch, RootHex} from "@lodestar/types";
import {GaugeExtra, MapDef, NoLabels, pruneSetToMax} from "@lodestar/utils";
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

export interface ShufflingCacheOptions {
  maxShufflingCacheEpochs?: number;
}

export interface IShufflingCache {
  addMetrics(metrics: ShufflingCacheMetrics | null): void;
  get(
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    caller: ShufflingCacheCaller
  ): Promise<EpochShuffling | null>;
  getSync(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex, caller: ShufflingCacheCaller): EpochShuffling | null;
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
  private metrics: ShufflingCacheMetrics | null = null;

  constructor(metrics: ShufflingCacheMetrics | null = null, opts: ShufflingCacheOptions = {}) {
    this.maxEpochs = opts.maxShufflingCacheEpochs ?? SHUFFLING_CACHE_MAX_EPOCHS;
    this.addMetrics(metrics);
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
  async get(
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    caller: ShufflingCacheCaller
  ): Promise<EpochShuffling | null> {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined) {
      this.metrics?.shufflingCache.cacheMiss.inc({caller});
      return null;
    }
    if (this.isShufflingCacheItem(cacheItem)) {
      this.metrics?.shufflingCache.cacheHit.inc({caller});
      return cacheItem.shuffling;
    } else {
      this.metrics?.shufflingCache.cacheHitUnresolvedPromise.inc({caller});
      return cacheItem.promise;
    }
  }

  /**
   * Will synchronously get a shuffling if it is available or will return null if not. The consumer
   * will have to then submit for building the shuffling. Metrics are collected by this._get
   */
  getSync(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex, caller: ShufflingCacheCaller): EpochShuffling | null {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(shufflingDecisionRoot);
    if (cacheItem === undefined) {
      this.metrics?.shufflingCache.cacheMiss.inc({caller});
      return null;
    }
    if (this.isPromiseCacheItem(cacheItem)) {
      this.metrics?.shufflingCache.cacheMissUnresolvedPromise.inc({caller});
      return null;
    }
    this.metrics?.shufflingCache.cacheHit.inc({caller});
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
    } else {
      this.metrics?.shufflingCache.cacheMiss.inc({caller: ShufflingCacheCaller.synchronousBuildShuffling});
    }

    const shuffling = this._buildSync(state, shufflingEpoch, shufflingDecisionRoot, activeIndexes);
    cacheItem?.resolveFn(shuffling);
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
    const item = this._insertShufflingPromise(shufflingEpoch, shufflingDecisionRoot);
    const shuffling = await this._build(state, shufflingEpoch, shufflingDecisionRoot, activeIndexes);
    item.resolveFn(shuffling);
    return shuffling;
  }

  private _buildSync(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): EpochShuffling {
    const shuffling = computeEpochShuffling(state, activeIndexes, shufflingEpoch);
    this.add(shufflingEpoch, shufflingDecisionRoot, shuffling);
    return shuffling;
  }

  private async _build(
    state: BeaconStateAllForks,
    shufflingEpoch: Epoch,
    shufflingDecisionRoot: RootHex,
    activeIndexes: number[]
  ): Promise<EpochShuffling> {
    // TODO: (matthewkeil) replace this sync call with a worker and async build function that uses
    //       a nice'd thread to build in core idle time
    //
    // Building will overwrite the ShufflingCachePromiseItem with the ShufflingCacheShufflingItem
    const shuffling = computeEpochShuffling(state, activeIndexes, shufflingEpoch);
    this.add(shufflingEpoch, shufflingDecisionRoot, shuffling);
    return shuffling;
  }

  private _insertShufflingPromise(shufflingEpoch: Epoch, shufflingDecisionRoot: RootHex): ShufflingCachePromiseItem {
    const promiseCount = Array.from(this.itemsByDecisionRootByEpoch.values())
      .flatMap((innerMap) => Array.from(innerMap.values()))
      .filter((item) => this.isPromiseCacheItem(item)).length;
    if (promiseCount >= SHUFFLING_CACHE_MAX_PROMISES) {
      throw new Error(
        `Too many shuffling promises: ${promiseCount}, shufflingEpoch: ${shufflingEpoch}, shufflingDecisionRoot: ${shufflingDecisionRoot}`
      );
    }
    let resolveFn!: (s: EpochShuffling) => void;
    const promise = new Promise<EpochShuffling>((resolve) => {
      resolveFn = resolve;
    });
    const item: ShufflingCachePromiseItem = {type: ShufflingCacheItemType.promise, promise, resolveFn};
    this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).set(shufflingDecisionRoot, item);
    return item;
  }

  private isShufflingCacheItem(item: ShufflingCacheItem): item is ShufflingCacheShufflingItem {
    return item.type === ShufflingCacheItemType.shuffling;
  }

  private isPromiseCacheItem(item: ShufflingCacheItem): item is ShufflingCachePromiseItem {
    return item.type === ShufflingCacheItemType.promise;
  }
}
