/**
 * @module validator
 */

import {Shard, Slot, ValidatorIndex} from "../types";
import {RpcClient} from "./rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";

export interface ValidatorCtx {
  rpcUrl?: string;
  rpc?: RpcClient;
  keypair: Keypair;
}

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

export interface GenesisInfo {
  startTime: number;
}
