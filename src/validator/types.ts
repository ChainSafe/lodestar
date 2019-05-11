/**
 * @module validator
 */

import {Shard, Slot, ValidatorIndex} from "../types";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";

export interface ValidatorCtx {
  keypair: Keypair;
  rpcUrl: string;
}

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

export interface GenesisInfo {
  startTime: number;
}
