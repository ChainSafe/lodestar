/**
 * @module validator
 */

import {bytes48, Slot, Shard, ValidatorIndex} from "../types";

export interface ValidatorCtx {
  publicKey: bytes48[];
  privateKey: bytes48[];
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
