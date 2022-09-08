import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY} from "@lodestar/params";
import {defaultOptions as defaultValidatorOptions} from "@lodestar/validator";
import {ArchiverOpts} from "./archiver/index.js";
import {ForkChoiceOpts} from "./forkChoice/index.js";
import {LightClientServerOpts} from "./lightClient/index.js";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlockProcessOpts &
  ForkChoiceOpts &
  ArchiverOpts &
  LightClientServerOpts & {
    blsVerifyAllMainThread?: boolean;
    blsVerifyAllMultiThread?: boolean;
    persistInvalidSszObjects?: boolean;
    persistInvalidSszObjectsDir?: string;
    skipCreateStateCacheIfAvailable?: boolean;
    suggestedFeeRecipient: string;
    maxSkipSlots?: number;
    /** Window to inspect missed slots for enabling/disabling builder circuit breaker */
    faultInspectionWindow?: number;
    /** Number of missed slots allowed in the faultInspectionWindow for builder circuit*/
    allowedFaults?: number;
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
   * Assert progressive balances the same to EpochProcess
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
};

export const defaultChainOptions: IChainOptions = {
  blsVerifyAllMainThread: false,
  blsVerifyAllMultiThread: false,
  disableBlsBatchVerify: false,
  proposerBoostEnabled: true,
  computeUnrealized: true,
  countUnrealizedFull: false,
  safeSlotsToImportOptimistically: SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY,
  suggestedFeeRecipient: defaultValidatorOptions.suggestedFeeRecipient,
  assertCorrectProgressiveBalances: false,
};
