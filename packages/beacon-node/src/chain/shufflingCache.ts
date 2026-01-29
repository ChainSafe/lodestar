import {ForkSeq} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  EpochShuffling,
  getAttestingIndices,
  getBeaconCommittees,
  getIndexedAttestation,
} from "@lodestar/state-transition";
import {Attestation, CommitteeIndex, Epoch, IndexedAttestation, RootHex, Slot} from "@lodestar/types";
import {LodestarError, Logger, MapDef, pruneSetToMax} from "@lodestar/utils";
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
  timeInsertedMs: number;
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
export class ShufflingCache {
  /** LRU cache implemented as a map, pruned every time we add an item */
  private readonly itemsByDecisionRootByEpoch: MapDef<Epoch, Map<RootHex, CacheItem>> = new MapDef(
    () => new Map<RootHex, CacheItem>()
  );

  private readonly maxEpochs: number;

  constructor(
    readonly metrics: Metrics | null = null,
    readonly logger: Logger | null = null,
    opts: ShufflingCacheOpts = {},
    precalculatedShufflings?: {shuffling: EpochShuffling | null; decisionRoot: RootHex}[]
  ) {
    if (metrics) {
      metrics.shufflingCache.size.addCollect(() =>
        metrics.shufflingCache.size.set(
          Array.from(this.itemsByDecisionRootByEpoch.values()).reduce((total, innerMap) => total + innerMap.size, 0)
        )
      );
    }

    this.maxEpochs = opts.maxShufflingCacheEpochs ?? MAX_EPOCHS;

    precalculatedShufflings?.map(({shuffling, decisionRoot}) => {
      if (shuffling !== null) {
        this.set(shuffling, decisionRoot);
      }
    });
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
      timeInsertedMs: Date.now(),
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
      this.metrics?.shufflingCache.miss.inc();
      return null;
    }

    if (isShufflingCacheItem(cacheItem)) {
      this.metrics?.shufflingCache.hit.inc();
      return cacheItem.shuffling;
    }
    this.metrics?.shufflingCache.shufflingPromiseNotResolved.inc();
    return cacheItem.promise;
  }

  /**
   * Get a shuffling synchronously, return null if not present.
   * The only time we have a promise cache item is when we regen shuffling for attestation, which never happens
   * with default chain option.
   */
  getSync(epoch: Epoch, decisionRoot: RootHex): EpochShuffling | null {
    const cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(epoch).get(decisionRoot);
    if (cacheItem === undefined) {
      this.metrics?.shufflingCache.miss.inc();
      return null;
    }

    if (isShufflingCacheItem(cacheItem)) {
      this.metrics?.shufflingCache.hit.inc();
      return cacheItem.shuffling;
    }

    return null;
  }

  /**
   * Process a state to extract and cache all shufflings (previous, current, next).
   * Uses the stored decision roots from epochCtx.
   */
  processState(state: CachedBeaconStateAllForks): void {
    const {epochCtx} = state;

    // Cache previous shuffling
    this.set(epochCtx.previousShuffling, epochCtx.previousDecisionRoot);

    // Cache current shuffling
    this.set(epochCtx.currentShuffling, epochCtx.currentDecisionRoot);

    // Cache next shuffling
    this.set(epochCtx.nextShuffling, epochCtx.nextDecisionRoot);
  }

  getIndexedAttestation(
    epoch: number,
    decisionRoot: string,
    fork: ForkSeq,
    attestation: Attestation
  ): IndexedAttestation {
    const shuffling = this.getShufflingOrThrow(epoch, decisionRoot);
    return getIndexedAttestation(shuffling, fork, attestation);
  }

  getAttestingIndices(epoch: number, decisionRoot: string, fork: ForkSeq, attestation: Attestation): number[] {
    const shuffling = this.getShufflingOrThrow(epoch, decisionRoot);
    return getAttestingIndices(shuffling, fork, attestation);
  }

  getBeaconCommittee(epoch: number, decisionRoot: string, slot: Slot, index: CommitteeIndex): Uint32Array {
    return this.getBeaconCommittees(epoch, decisionRoot, slot, [index])[0];
  }

  getBeaconCommittees(epoch: number, decisionRoot: string, slot: Slot, indices: CommitteeIndex[]): Uint32Array[] {
    const shuffling = this.getShufflingOrThrow(epoch, decisionRoot);
    return getBeaconCommittees(shuffling, slot, indices);
  }

  private getShufflingOrThrow(epoch: number, decisionRoot: string): EpochShuffling {
    const shuffling = this.getSync(epoch, decisionRoot);
    if (shuffling === null) {
      throw new ShufflingCacheError({
        code: ShufflingCacheErrorCode.NO_SHUFFLING_FOUND,
        epoch,
        decisionRoot,
      });
    }
    return shuffling;
  }

  /**
   * Add an EpochShuffling to the ShufflingCache. If a promise for the shuffling is present it will
   * resolve the promise with the built shuffling
   */
  private set(shuffling: EpochShuffling, decisionRoot: string): void {
    const shufflingAtEpoch = this.itemsByDecisionRootByEpoch.getOrDefault(shuffling.epoch);
    // if a pending shuffling promise exists, resolve it
    const cacheItem = shufflingAtEpoch.get(decisionRoot);
    if (cacheItem) {
      if (isPromiseCacheItem(cacheItem)) {
        cacheItem.resolveFn(shuffling);
        this.metrics?.shufflingCache.shufflingPromiseResolutionTime.observe(
          (Date.now() - cacheItem.timeInsertedMs) / 1000
        );
      } else {
        this.metrics?.shufflingCache.shufflingSetMultipleTimes.inc();
        return;
      }
    }
    // set the shuffling
    shufflingAtEpoch.set(decisionRoot, {type: CacheItemType.shuffling, shuffling});
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
