import {SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY} from "@chainsafe/lodestar-params";
import {ForkChoiceOpts} from "./forkChoice";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlockProcessOpts &
  ForkChoiceOpts & {
    blsVerifyAllMainThread?: boolean;
    blsVerifyAllMultiThread?: boolean;
    persistInvalidSszObjects?: boolean;
    persistInvalidSszObjectsDir: string;
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
};

export const defaultChainOptions: IChainOptions = {
  blsVerifyAllMainThread: false,
  blsVerifyAllMultiThread: false,
  disableBlsBatchVerify: false,
  persistInvalidSszObjects: true,
  persistInvalidSszObjectsDir: "",
  proposerBoostEnabled: false,
  safeSlotsToImportOptimistically: SAFE_SLOTS_TO_IMPORT_OPTIMISTICALLY,
};
