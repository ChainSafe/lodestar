/**
 * @module validator
 */
import {ValidatorDuty} from "@chainsafe/lodestar-types";

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface GenesisInfo {
  startTime: number;
}

export interface IAttesterDuty extends ValidatorDuty {
  isAggregator: boolean;
}