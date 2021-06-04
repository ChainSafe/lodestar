import {BlsVerifierOpts} from "./bls";
import {BlockProcessOpts} from "./blocks/process";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlsVerifierOpts & BlockProcessOpts;

export const defaultChainOptions: IChainOptions = {
  useSingleThreadVerifier: false,
  disableBlsBatchVerify: false,
};
