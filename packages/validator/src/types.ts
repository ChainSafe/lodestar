/**
 * @module validator
 */
import {SecretKey} from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";
import {IDatabaseController} from "@chainsafe/lodestar-db";

export type GenesisInfo = {
  startTime: number;
};

export interface IAttesterDuty extends phase0.AttesterDuty {
  isAggregator: boolean;
}

export type ValidatorAndSecret = {
  validator: phase0.ValidatorResponse | null;
  secretKey: SecretKey;
};

export type PublicKeyHex = string;
export type LodestarValidatorDatabaseController = Pick<
  IDatabaseController<Buffer, Buffer>,
  "get" | "start" | "values" | "batchPut" | "keys" | "get" | "put"
>;
