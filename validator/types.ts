import {bytes48} from "../src/types";

export interface ValidatorCtx {
  publicKey: bytes48[];
  privateKey: bytes48[];
  rpcUrl: string;
}

export interface GenesisInfo {
  startTime: number;
}
