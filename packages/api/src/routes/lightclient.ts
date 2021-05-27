import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Path} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {altair, SyncPeriod} from "@chainsafe/lodestar-types";
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

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  /** TODO: description */
  getStateProof(stateId: string, paths: Path[]): Promise<{data: Proof}>;
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
  getStateProof: {url: "/eth/v1/lightclient/proof/:stateId", method: "POST"},
  getBestUpdates: {url: "/eth/v1/lightclient/best_updates/:periods", method: "GET"},
  getLatestUpdateFinalized: {url: "/eth/v1/lightclient/latest_update_finalized/", method: "GET"},
  getLatestUpdateNonFinalized: {url: "/eth/v1/lightclient/latest_update_nonfinalized/", method: "GET"},
};

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerializers>]: ReturnType<ReturnType<typeof getReqSerializers>[K]["writeReq"]>;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerializers() {
  const t = mapValues(routesData, () => (arg: unknown) => arg) as RouteReqTypeGenerator<Api>;

  return {
    getStateProof: t.getStateProof<{params: {stateId: string}; body: Path[]}>({
      writeReq: (stateId, paths) => ({params: {stateId}, body: paths}),
      parseReq: ({params, body}) => [params.stateId, body],
      schema: {params: {stateId: Schema.StringRequired}, body: Schema.AnyArray},
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
    getStateProof: sameType(),
    getBestUpdates: ContainerData(ArrayOf(config.types.altair.LightClientUpdate)),
    getLatestUpdateFinalized: ContainerData(config.types.altair.LightClientUpdate),
    getLatestUpdateNonFinalized: ContainerData(config.types.altair.LightClientUpdate),
  };
}
