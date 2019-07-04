/**
 * @module validator
 */

import {Shard, Slot, ValidatorIndex} from "../../types";
import {RpcClient} from "./rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {IValidatorDB} from "../db/api/validator/interface";

export interface ValidatorCtx {
  rpcUrl?: string;
  rpc?: RpcClient;
  keypair: Keypair;
  db?: IValidatorDB;
}

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

export interface GenesisInfo {
  startTime: number;
}
