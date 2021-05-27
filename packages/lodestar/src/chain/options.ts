import {BlsVerifierOpts} from "./bls";

// eslint-disable-next-line @typescript-eslint/ban-types
export type IChainOptions = BlsVerifierOpts;

export const defaultChainOptions: IChainOptions = {
  useSingleThreadVerifier: false,
};
