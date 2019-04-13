import {BeaconState, bytes48} from "../types";
import {Shard, ValidatorIndex} from "./index";
import {Slot} from "./custom";

export interface ValidatorCtx {
  publicKey: bytes48[];
  privateKey: bytes48[];
  rpcUrl: string;
}

export interface GenesisInfo {
  startTime: number;
}

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}
