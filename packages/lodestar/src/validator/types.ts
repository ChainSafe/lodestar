/**
 * @module validator
 */

import {Shard, Slot, ValidatorIndex} from "../types";

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

export interface GenesisInfo {
  startTime: number;
}
