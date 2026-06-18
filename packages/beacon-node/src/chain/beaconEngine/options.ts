import {BlsMultiThreadWorkerPoolOptions} from "../bls/index.js";
import {ForkChoiceOpts} from "../forkChoice/index.js";
import {ShufflingCacheOpts} from "../shufflingCache.js";
import {FIFOBlockStateCacheOpts} from "../stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCacheOpts} from "../stateCache/persistentCheckpointsCache.js";

export type PoolOpts = {
  /**
   * Only preaggregate attestation/sync committee message since clockSlot - preaggregateSlotDistance
   */
  preaggregateSlotDistance?: number;
};

export type SeenCacheOpts = {
  /**
   * Slot distance from current slot to cache AttestationData
   */
  attDataCacheSlotDistance?: number;
};

/**
 * Options consumed by the consensus engine and its collaborators. `IChainOptions` extends this;
 * the BeaconEngine module references only `IBeaconEngineOptions` so the seam stays self-contained.
 */
export type IBeaconEngineOptions = ShufflingCacheOpts &
  PoolOpts &
  SeenCacheOpts &
  FIFOBlockStateCacheOpts &
  PersistentCheckpointStateCacheOpts &
  ForkChoiceOpts &
  BlsMultiThreadWorkerPoolOptions & {
    blsVerifyAllMainThread?: boolean;
  };
