import {BlockProcessOpts} from "./blocks/process";
import {ForkChoiceOpts} from "./forkChoice";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlockProcessOpts &
  ForkChoiceOpts & {
    useSingleThreadVerifier?: boolean;
    persistInvalidSszObjects?: boolean;
    persistInvalidSszObjectsDir: string;
  };

export const defaultChainOptions: IChainOptions = {
  useSingleThreadVerifier: false,
  disableBlsBatchVerify: false,
  persistInvalidSszObjects: true,
  persistInvalidSszObjectsDir: "",
};
