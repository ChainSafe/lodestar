/**
 * @module validator
 */

import {Shard, Slot, ValidatorIndex} from "@chainsafe/eth2.0-types";

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface GenesisInfo {
  startTime: number;
}
