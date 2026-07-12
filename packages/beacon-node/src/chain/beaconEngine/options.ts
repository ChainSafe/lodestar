import {StatesArchiveOpts} from "../archiveStore/interface.js";
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
  StatesArchiveOpts &
  BlsMultiThreadWorkerPoolOptions & {
    blsVerifyAllMainThread?: boolean;
    /** Serve historical (below-finalized) states via the engine-owned worker thread */
    serveHistoricalState?: boolean;
    /** Use the native state view in the historical-state worker */
    nativeStateView?: boolean;
    /** Gossip block/blob/data-column validation observes (no longer gates) skipped slots */
    maxSkipSlots?: number;
    /** Min number of same-message signature sets to batch in gossip attestation validation */
    minSameMessageSignatureSetsToBatch: number;
    /** By default the engine passes gossip-validated attestations to fork choice; set to skip that write */
    dontSendGossipAttestationsToForkchoice?: boolean;
    /** Default fee recipient used by the engine-owned beaconProposerCache */
    suggestedFeeRecipient: string;
    /** Emit an SSE payloadAttributes event every slot (not only when proposing) */
    emitPayloadAttributes?: boolean;
    /** Persist orphaned (non-canonical finalized) blocks to disk before deleting them on finalization */
    persistOrphanedBlocks?: boolean;
    persistOrphanedBlocksDir?: string;
  };
