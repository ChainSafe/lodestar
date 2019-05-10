/**
 * @module validator
 */

import {bytes48, Slot, Shard, ValidatorIndex, BLSPubkey} from "../types";
import {RpcClient} from "./rpc";

export interface ValidatorCtx {
  publicKey: BLSPubkey;
  privateKey: bytes48[];
  rpcUrl?: string;
  rpc?: RpcClient;
}

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

export interface GenesisInfo {
  startTime: number;
}
