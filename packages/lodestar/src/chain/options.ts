import {BlockProcessOpts} from "./blocks/process";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlockProcessOpts & {
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
