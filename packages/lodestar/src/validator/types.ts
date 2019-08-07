/**
 * @module validator
 */

import {Shard, Slot, ValidatorIndex} from "@chainsafe/eth2.0-types";

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

export interface GenesisInfo {
  startTime: number;
}
