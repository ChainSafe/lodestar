import {ChainForkConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {ApiClientResponse} from "../../../interfaces.js";
import {HttpStatusCode} from "../../../utils/client/httpStatusCode.js";
import {RoutesData, ReturnTypes, reqEmpty, ContainerData} from "../../../utils/index.js";
import * as block from "./block.js";
import * as pool from "./pool.js";
import * as state from "./state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

// NOTE: We choose to split the block, pool, and state namespaces so the files are not too big.
// However, for a consumer all these methods are within the same service "beacon"

export * as block from "./block.js";
export * as pool from "./pool.js";
export * as state from "./state.js";
export {BlockId, BlockHeaderResponse} from "./block.js";
export {AttestationFilters} from "./pool.js";
// TODO: Review if re-exporting all these types is necessary
export {
  StateId,
  ValidatorId,
  ValidatorStatus,
  ValidatorFilters,
  CommitteesFilters,
  FinalityCheckpoints,
  ValidatorResponse,
  ValidatorBalance,
  EpochCommitteeResponse,
  EpochSyncCommitteeResponse,
} from "./state.js";

export type Api = block.Api &
  pool.Api &
  state.Api & {
    getGenesis(): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: phase0.Genesis}}>>;
  };

export const routesData: RoutesData<Api> = {
  getGenesis: {url: "/eth/v1/beacon/genesis", method: "GET"},
  ...block.routesData,
  ...pool.routesData,
  ...state.routesData,
};

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerializers>]: ReturnType<ReturnType<typeof getReqSerializers>[K]["writeReq"]>;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getReqSerializers(config: ChainForkConfig) {
  return {
    getGenesis: reqEmpty,
    ...block.getReqSerializers(config),
    ...pool.getReqSerializers(),
    ...state.getReqSerializers(),
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getGenesis: ContainerData(ssz.phase0.Genesis),
    ...block.getReturnTypes(),
    ...pool.getReturnTypes(),
    ...state.getReturnTypes(),
  };
}
