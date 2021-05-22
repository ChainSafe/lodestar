import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Path} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {altair, Bytes32, Number64, SyncPeriod} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {
  ArrayOf,
  reqEmpty,
  ReturnTypes,
  RoutesData,
  Schema,
  RouteReqTypeGenerator,
  sameType,
  ContainerData,
} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

export interface DepositContract {
  chainId: Number64;
  address: Bytes32;
}

export type Api = {
  /** TODO: description */
  createStateProof(stateId: string, paths: Path[]): Promise<{data: Proof}>;
  /** TODO: description */
  getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<{data: altair.LightClientUpdate[]}>;
  /** TODO: description */
  getLatestUpdateFinalized(): Promise<{data: altair.LightClientUpdate}>;
  /** TODO: description */
  getLatestUpdateNonFinalized(): Promise<{data: altair.LightClientUpdate}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  createStateProof: {url: "/eth/v1/lightclient/proof/:stateId", method: "POST"},
  getBestUpdates: {url: "/eth/v1/lightclient/best_updates/:periods", method: "GET"},
  getLatestUpdateFinalized: {url: "/eth/v1/lightclient/latest_update_finalized/", method: "GET"},
  getLatestUpdateNonFinalized: {url: "/eth/v1/lightclient/latest_update_nonfinalized/", method: "GET"},
};

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerdes>]: ReturnType<ReturnType<typeof getReqSerdes>[K]["writeReq"]>;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerdes() {
  const t = mapValues(routesData, () => (arg: unknown) => arg) as RouteReqTypeGenerator<Api>;

  return {
    createStateProof: t.createStateProof<{params: {stateId: string}; body: Path[]}>({
      writeReq: (stateId, paths) => ({params: {stateId}, body: paths}),
      parseReq: ({params, body}) => [params.stateId, body],
      schema: {params: {stateId: Schema.StringRequired}, body: Schema.ObjectArray},
    }),

    getBestUpdates: t.getBestUpdates<{query: {from: number; to: number}}>({
      writeReq: (from, to) => ({query: {from, to}}),
      parseReq: ({query}) => [query.from, query.to],
      schema: {query: {from: Schema.UintRequired, to: Schema.UintRequired}},
    }),

    getLatestUpdateFinalized: reqEmpty,
    getLatestUpdateNonFinalized: reqEmpty,
  };
}

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  return {
    // Just sent the proof JSON as-is
    createStateProof: sameType(),
    getBestUpdates: ContainerData(ArrayOf(config.types.altair.LightClientUpdate)),
    getLatestUpdateFinalized: ContainerData(config.types.altair.LightClientUpdate),
    getLatestUpdateNonFinalized: ContainerData(config.types.altair.LightClientUpdate),
  };
}
