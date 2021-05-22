import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {RoutesData, ReturnTypes, reqEmpty, ContainerData} from "../../utils";
import * as block from "./block";
import * as pool from "./pool";
import * as state from "./state";

// NOTE: We choose to split the block, pool, and state namespaces so the files are not too big.
// However, for a consumer all these methods are within the same service "beacon"

export {BlockId, BlockHeaderResponse} from "./block";
export {AttestationFilters} from "./pool";
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
} from "./state";

export type Api = block.Api &
  pool.Api &
  state.Api & {
    getGenesis(): Promise<{data: phase0.Genesis}>;
  };

export const routesData: RoutesData<Api> = {
  getGenesis: {url: "/eth/v1/beacon/genesis", method: "GET"},
  ...block.routesData,
  ...pool.routesData,
  ...state.routesData,
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerdes(config: IBeaconConfig) {
  return {
    getGenesis: reqEmpty,
    ...block.getReqSerdes(config),
    ...pool.getReqSerdes(config),
    ...state.getReqSerdes(),
  };
}

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerdes>]: ReturnType<ReturnType<typeof getReqSerdes>[K]["writeReq"]>;
};

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  return {
    getGenesis: ContainerData(config.types.phase0.Genesis),
    ...block.getReturnTypes(config),
    ...pool.getReturnTypes(config),
    ...state.getReturnTypes(config),
  };
}
