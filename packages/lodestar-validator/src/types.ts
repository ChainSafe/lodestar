/**
 * @module validator
 */
import {ValidatorDuty} from "@chainsafe/eth2.0-types";

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface GenesisInfo {
  startTime: number;
}

export interface IAttesterDuty extends ValidatorDuty {
  isAggregator: boolean;
}