import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY} from "@lodestar/params";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {ArchiverOpts} from "./archiver/index.js";
import {ForkChoiceOpts} from "./forkChoice/index.js";
import {LightClientServerOpts} from "./lightClient/index.js";
import {ShufflingCacheOpts} from "./shufflingCache.js";

export type IChainOptions = BlockProcessOpts &
  PoolOpts &
  SeenCacheOpts &
  ForkChoiceOpts &
  ArchiverOpts &
  ShufflingCacheOpts &
  LightClientServerOpts & {
    blsVerifyAllMainThread?: boolean;
    blsVerifyAllMultiThread?: boolean;
    persistInvalidSszObjects?: boolean;
    persistInvalidSszObjectsDir?: string;
    skipCreateStateCacheIfAvailable?: boolean;
    suggestedFeeRecipient: string;
    maxSkipSlots?: number;
    /** Ensure blobs returned by the execution engine are valid */
    sanityCheckExecutionEngineBlobs?: boolean;
    /** Max number of produced blobs by local validators to cache */
    maxCachedBlobSidecars?: number;
    /** Max number of produced block roots (blinded or full) cached for broadcast validations */
    maxCachedProducedRoots?: number;
    /** Option to load a custom kzg trusted setup in txt format */
    trustedSetup?: string;
    broadcastValidationStrictness?: string;
    minSameMessageSignatureSetsToBatch: number;
  };

export type BlockProcessOpts = {
  /**
   * Do not use BLS batch verify to validate all block signatures at once.
   * Will double processing times. Use only for debugging purposes.
   */
  disableBlsBatchVerify?: boolean;
  /**
   * Override SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY
   */
  safeSlotsToImportOptimistically: number;
  /**
   * Assert progressive balances the same to EpochTransitionCache
   */
  assertCorrectProgressiveBalances?: boolean;
  /** Used for fork_choice spec tests */
  disableOnBlockError?: boolean;
  /** Used for fork_choice spec tests */
  disablePrepareNextSlot?: boolean;
  /**
   * Used to connect beacon in follow mode to an EL,
   * will still issue fcU for block proposal
   */
  disableImportExecutionFcU?: boolean;
  emitPayloadAttributes?: boolean;
};

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

export const defaultChainOptions: IChainOptions = {
  blsVerifyAllMainThread: false,
  blsVerifyAllMultiThread: false,
  disableBlsBatchVerify: false,
  proposerBoostEnabled: true,
  computeUnrealized: true,
  safeSlotsToImportOptimistically: SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY,
  suggestedFeeRecipient: defaultValidatorOptions.suggestedFeeRecipient,
  assertCorrectProgressiveBalances: false,
  archiveStateEpochFrequency: 1024,
  emitPayloadAttributes: false,
  // for gossip block validation, it's unlikely we see a reorg with 32 slots
  // for attestation validation, having this value ensures we don't have to regen states most of the time
  maxSkipSlots: 32,
  broadcastValidationStrictness: "warn",
  // should be less than or equal to MIN_SIGNATURE_SETS_TO_BATCH_VERIFY
  // batching too much may block the I/O thread so if useWorker=false, suggest this value to be 32
  // since this batch attestation work is designed to work with useWorker=true, make this the lowest value
  minSameMessageSignatureSetsToBatch: 2,
};
