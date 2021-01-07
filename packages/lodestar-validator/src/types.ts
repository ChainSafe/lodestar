/**
 * @module validator
 */
import {SecretKey} from "@chainsafe/bls";
import {AttesterDuty, ValidatorResponse} from "@chainsafe/lodestar-types";

export type GenesisInfo = {
  startTime: number;
};

export interface IAttesterDuty extends AttesterDuty {
  isAggregator: boolean;
}

export type ValidatorAndSecret = {
  validator: ValidatorResponse | null;
  secretKey: SecretKey;
};
