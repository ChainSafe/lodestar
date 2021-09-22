import {ForkChoiceOpts} from "./forkChoice";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlockProcessOpts &
  ForkChoiceOpts & {
    useSingleThreadVerifier?: boolean;
    persistInvalidSszObjects?: boolean;
    persistInvalidSszObjectsDir: string;
  };

export type BlockProcessOpts = {
  /**
   * Do not use BLS batch verify to validate all block signatures at once.
   * Will double processing times. Use only for debugging purposes.
   */
  disableBlsBatchVerify?: boolean;
};

export const defaultChainOptions: IChainOptions = {
  useSingleThreadVerifier: false,
  disableBlsBatchVerify: false,
  persistInvalidSszObjects: true,
  persistInvalidSszObjectsDir: "",
};
