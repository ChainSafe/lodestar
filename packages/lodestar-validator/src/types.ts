/**
 * @module validator
 */
import {SecretKey} from "@chainsafe/bls";
import {AttesterDuty, ValidatorResponse} from "@chainsafe/lodestar-types";
import {IDatabaseController} from "@chainsafe/lodestar-db";

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

export type PublicKeyHex = string;
export type LodestarValidatorDatabaseController = Pick<
  IDatabaseController<Buffer, Buffer>,
  "get" | "start" | "values" | "batchPut" | "keys" | "get" | "put"
>;
