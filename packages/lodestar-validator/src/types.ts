/**
 * @module validator
 */
import {AttesterDuty} from "@chainsafe/lodestar-types";

export type GenesisInfo = {
  startTime: number;
};

export interface IAttesterDuty extends AttesterDuty {
  // internal index
  attesterIndex: number;
  isAggregator: boolean;
}
