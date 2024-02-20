import {toHexString} from "@chainsafe/ssz";
import {
  BaseShufflingCache,
  BaseShufflingCacheOptions,
  CachedBeaconStateAllForks,
  EpochShuffling,
  getShufflingDecisionBlock,
} from "@lodestar/state-transition";
import {Epoch, RootHex, ssz} from "@lodestar/types";
import {GENESIS_SLOT} from "@lodestar/params";
import {Metrics} from "../metrics/metrics.js";
import {computeAnchorCheckpoint} from "./initState.js";

export interface ShufflingCacheOptions extends BaseShufflingCacheOptions {}

/**
 * A shuffling cache to help:
 * - get committee quickly for attestation verification
 * - if a shuffling is not available (which does not happen with default chain option of maxSkipSlots = 32), track a promise to make sure we don't compute the same shuffling twice
 * - skip computing shuffling when loading state bytes from disk
 */
export class ShufflingCache extends BaseShufflingCache {
  constructor(
    private readonly metrics: Metrics | null = null,
    opts: ShufflingCacheOptions = {}
  ) {
    super(opts);
    if (metrics) {
      metrics.shufflingCache.size.addCollect(() =>
        metrics.shufflingCache.size.set(
          Array.from(this.itemsByDecisionRootByEpoch.values()).reduce((total, innerMap) => total + innerMap.size, 0)
        )
      );
    }
  }

  /**
   * Extract shuffling from state and add to cache
   */
  processState(state: CachedBeaconStateAllForks, shufflingEpoch: Epoch): EpochShuffling {
    const decisionBlockHex = getDecisionBlock(state, shufflingEpoch);
    // let shuffling: EpochShuffling;
    // switch (shufflingEpoch) {
    //   case state.epochCtx.nextEpoch:
    //     shuffling = state.epochCtx.nextShuffling;
    //     break;
    //   case state.epochCtx.epoch:
    //     shuffling = state.epochCtx.currentShuffling;
    //     break;
    //   case state.epochCtx.previousEpoch:
    //     shuffling = state.epochCtx.previousShuffling;
    //     break;
    //   default:
    //     throw new Error(`Shuffling not found from state ${state.slot} for epoch ${shufflingEpoch}`);
    // }

    let cacheItem = this.itemsByDecisionRootByEpoch.getOrDefault(shufflingEpoch).get(decisionBlockHex);
    if (cacheItem !== undefined) {
      // update existing promise
      if (isPromiseCacheItem(cacheItem)) {
        // unblock consumers of this promise
        cacheItem.resolveFn(shuffling);
        // then update item type to shuffling
        cacheItem = {
          type: CacheItemType.shuffling,
          shuffling,
        };
        this.add(shufflingEpoch, decisionBlockHex, cacheItem);
        // we updated type to CacheItemType.shuffling so the above fields are not used anyway
        this.metrics?.shufflingCache.processStateUpdatePromise.inc();
      } else {
        // ShufflingCacheItem, do nothing
        this.metrics?.shufflingCache.processStateNoOp.inc();
      }
    } else {
      // not found, new shuffling
      this.add(shufflingEpoch, decisionBlockHex, {type: CacheItemType.shuffling, shuffling});
      this.metrics?.shufflingCache.processStateInsertNew.inc();
    }

    return shuffling;
  }

  /**
   * Insert a promise to make sure we don't regen state for the same shuffling.
   * Bound by MAX_SHUFFLING_PROMISE to make sure our node does not blow up.
   */
  insertPromise(shufflingEpoch: Epoch, decisionRootHex: RootHex): void {
    const promiseCount = Array.from(this.itemsByDecisionRootByEpoch.values())
      .flatMap((innerMap) => Array.from(innerMap.values()))
      .filter((item) => isPromiseCacheItem(item)).length;
    if (promiseCount >= MAX_PROMISES) {
      throw new Error(
        `Too many shuffling promises: ${promiseCount}, shufflingEpoch: ${shufflingEpoch}, decisionRootHex: ${decisionRootHex}`
      );
    }

    let resolveFn!: (shuffling: EpochShuffling) => void;
    const promise = new Promise<EpochShuffling>((resolve) => {
      resolveFn = resolve;
    });

    const cacheItem: PromiseCacheItem = {
      type: CacheItemType.promise,
      promise,
      resolveFn,
    };
    this.add(shufflingEpoch, decisionRootHex, cacheItem);
    this.metrics?.shufflingCache.insertPromiseCount.inc();
  }
}

// TODO: @tuyennhv why is this here and not in state-transition with `getShufflingDecisionBlock`?
/**
 * Get the shuffling decision block root for the given epoch of given state
 *   - Special case close to genesis block, return the genesis block root
 *   - This is similar to forkchoice.getDependentRoot() function, otherwise we cannot get cached shuffing in attestation verification when syncing from genesis.
 */
function getDecisionBlock(state: CachedBeaconStateAllForks, epoch: Epoch): RootHex {
  return state.slot > GENESIS_SLOT
    ? getShufflingDecisionBlock(state, epoch)
    : toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(computeAnchorCheckpoint(state.config, state).blockHeader));
}
