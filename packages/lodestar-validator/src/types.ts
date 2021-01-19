/**
 * @module validator
 */
import {IDatabaseController} from "@chainsafe/lodestar-db";
import {AttesterDuty} from "@chainsafe/lodestar-types";

export type GenesisInfo = {
  startTime: number;
};

export interface IAttesterDuty extends AttesterDuty {
  // internal index
  attesterIndex: number;
  isAggregator: boolean;
}

export type LodestarValidatorDatabaseController = Pick<
  IDatabaseController<Buffer, Buffer>,
  "get" | "start" | "values" | "batchPut" | "keys" | "get" | "put"
>;
