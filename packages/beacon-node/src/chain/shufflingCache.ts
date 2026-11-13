import {ForkSeq, GENESIS_EPOCH} from "@lodestar/params";
import {
  EpochShuffling,
  IBeaconStateView,
  getAttestingIndices,
  getBeaconCommittees,
  getIndexedAttestation,
} from "@lodestar/state-transition";
import {Attestation, CommitteeIndex, Epoch, IndexedAttestation, RootHex, Slot} from "@lodestar/types";
import {LodestarError, Logger, MapDef} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";

/**
 * Lookahead duties, gossip validation, and block production need epochs n-1, n, and n+1 for current epoch n.
 * Keep the 4 highest epochs so that it works for epoch rotation.
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
  /** Resolves to null if the promise is cancelled */
  promise: Promise<EpochShuffling | null>;
  resolveFn: (shuffling: EpochShuffling | null) => void;
};

type CacheItem = ShufflingCacheItem | PromiseCacheItem;

export enum ShufflingPromiseCancelReason {
  regenError = "regen_error",
  decisionRootMismatch = "decision_root_mismatch",
  pruned = "pruned",
}

export type ShufflingCacheOpts = {
  maxShufflingCacheEpochs?: number;
};

/**
 * Cache recent epoch shufflings for lookahead duties, gossip validation, and block production.
 * Pending promises deduplicate computation of missing shufflings.
 */
export class ShufflingCache {
  /** Pruned to the `maxEpochs` highest epochs every time we add a shuffling */
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
      metrics.shufflingCache.epochs.addCollect(() =>
        metrics.shufflingCache.epochs.set(this.itemsByDecisionRootByEpoch.size)
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
    let resolveFn: ((shuffling: EpochShuffling | null) => void) | null = null;
    const promise = new Promise<EpochShuffling | null>((resolve) => {
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
    const cacheItem = this.itemsByDecisionRootByEpoch.get(epoch)?.get(decisionRoot);
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
   * Get a shuffling synchronously, return null if not present or if it's still being computed.
   */
  getSync(epoch: Epoch, decisionRoot: RootHex): EpochShuffling | null {
    const cacheItem = this.itemsByDecisionRootByEpoch.get(epoch)?.get(decisionRoot);
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
   * Check if a shuffling is cached by (epoch, decisionRoot).
   * For native bindings, this avoids having to memoize heavy epoch shufflings within
   * `NativeBeaconStateView`.
   */
  has(epoch: Epoch, decisionRoot: RootHex): boolean {
    const cacheItem = this.itemsByDecisionRootByEpoch.get(epoch)?.get(decisionRoot);
    return cacheItem !== undefined && isShufflingCacheItem(cacheItem);
  }

  /**
   * Process a state to extract and cache all shufflings (previous, current, next).
   * Uses the stored decision roots from epochCtx.
   */
  processState(state: IBeaconStateView): void {
    const currentEpoch = state.epoch;
    const previousEpoch = currentEpoch === GENESIS_EPOCH ? GENESIS_EPOCH : currentEpoch - 1;

    if (!this.has(previousEpoch, state.previousDecisionRoot)) {
      this.set(state.getPreviousShuffling(), state.previousDecisionRoot);
    }

    if (!this.has(currentEpoch, state.currentDecisionRoot)) {
      this.set(state.getCurrentShuffling(), state.currentDecisionRoot);
    }

    if (!this.has(currentEpoch + 1, state.nextDecisionRoot)) {
      this.set(state.getNextShuffling(), state.nextDecisionRoot);
    }
  }

  /**
   * Resolve a pending promise with null so that waiters don't hang, then remove it.
   */
  cancelPromise(epoch: Epoch, decisionRoot: RootHex, reason: ShufflingPromiseCancelReason): void {
    const itemsByDecisionRoot = this.itemsByDecisionRootByEpoch.get(epoch);
    const cacheItem = itemsByDecisionRoot?.get(decisionRoot);
    if (itemsByDecisionRoot === undefined || cacheItem === undefined || !isPromiseCacheItem(cacheItem)) {
      return;
    }

    cacheItem.resolveFn(null);
    itemsByDecisionRoot.delete(decisionRoot);
    if (itemsByDecisionRoot.size === 0) {
      this.itemsByDecisionRootByEpoch.delete(epoch);
    }
    this.metrics?.shufflingCache.cancelledPromises.inc({reason});
    this.logger?.debug("Cancelled shuffling promise", {epoch, decisionRoot, reason});
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

  getBeaconCommitteeOrNull(epoch: number, decisionRoot: string, slot: Slot, index: CommitteeIndex): Uint32Array | null {
    const shuffling = this.getSync(epoch, decisionRoot);
    return shuffling === null ? null : getBeaconCommittees(shuffling, slot, [index])[0];
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
    this.prune();
  }

  /**
   * Keep the `maxEpochs` highest epochs, regardless of insertion order.
   */
  private prune(): void {
    const toDelete = this.itemsByDecisionRootByEpoch.size - this.maxEpochs;
    if (toDelete <= 0) {
      return;
    }

    const prunedEpochs = Array.from(this.itemsByDecisionRootByEpoch.keys())
      .sort((a, b) => a - b)
      .slice(0, toDelete);
    let prunedShufflings = 0;
    for (const epoch of prunedEpochs) {
      for (const cacheItem of this.itemsByDecisionRootByEpoch.get(epoch)?.values() ?? []) {
        if (isPromiseCacheItem(cacheItem)) {
          cacheItem.resolveFn(null);
          this.metrics?.shufflingCache.cancelledPromises.inc({reason: ShufflingPromiseCancelReason.pruned});
        } else {
          prunedShufflings++;
        }
      }
      this.itemsByDecisionRootByEpoch.delete(epoch);
    }
    this.metrics?.shufflingCache.prunedShufflings.inc(prunedShufflings);

    this.logger?.verbose("Pruned shuffling cache", {
      prunedEpochs: prunedEpochs.join(","),
      prunedShufflings,
      cachedEpochs: Array.from(this.itemsByDecisionRootByEpoch.keys())
        .sort((a, b) => a - b)
        .join(","),
    });
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
