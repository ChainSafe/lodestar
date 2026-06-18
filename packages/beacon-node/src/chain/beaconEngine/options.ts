import {BlsMultiThreadWorkerPoolOptions} from "../bls/index.js";
import {ShufflingCacheOpts} from "../shufflingCache.js";

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
  BlsMultiThreadWorkerPoolOptions & {
    blsVerifyAllMainThread?: boolean;
  };
