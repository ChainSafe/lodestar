import {BeaconState, bytes48} from "../types";

export interface ValidatorCtx {
  publicKey: bytes48[];
  privateKey: bytes48[];
  rpcUrl: string;
}

export interface GenesisInfo {
  startTime: number;
}
