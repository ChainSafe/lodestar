import {Path} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {altair, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {
  ArrayOf,
  reqEmpty,
  ReturnTypes,
  RoutesData,
  Schema,
  sameType,
  ContainerData,
  ReqSerializers,
  ReqEmpty,
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
  /**
   * Fetch a proof needed for light client initialization
   */
  getInitProof(blockRoot: string): Promise<{data: Proof}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getStateProof: {url: "/eth/v1/lightclient/proof/:stateId", method: "POST"},
  getBestUpdates: {url: "/eth/v1/lightclient/best_updates", method: "GET"},
  getLatestUpdateFinalized: {url: "/eth/v1/lightclient/latest_update_finalized", method: "GET"},
  getLatestUpdateNonFinalized: {url: "/eth/v1/lightclient/latest_update_nonfinalized", method: "GET"},
  getInitProof: {url: "/eth/v1/lightclient/init_proof/:blockRoot", method: "GET"},
};

export type ReqTypes = {
  getStateProof: {params: {stateId: string}; body: Path[]};
  getBestUpdates: {query: {from: number; to: number}};
  getLatestUpdateFinalized: ReqEmpty;
  getLatestUpdateNonFinalized: ReqEmpty;
  getInitProof: {params: {blockRoot: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (stateId, paths) => ({params: {stateId}, body: paths}),
      parseReq: ({params, body}) => [params.stateId, body],
      schema: {params: {stateId: Schema.StringRequired}, body: Schema.AnyArray},
    },

    getBestUpdates: {
      writeReq: (from, to) => ({query: {from, to}}),
      parseReq: ({query}) => [query.from, query.to],
      schema: {query: {from: Schema.UintRequired, to: Schema.UintRequired}},
    },

    getLatestUpdateFinalized: reqEmpty,
    getLatestUpdateNonFinalized: reqEmpty,

    getInitProof: {
      writeReq: (blockRoot) => ({params: {blockRoot}}),
      parseReq: ({params}) => [params.blockRoot],
      schema: {params: {blockRoot: Schema.StringRequired}},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
    getBestUpdates: ContainerData(ArrayOf(ssz.altair.LightClientUpdate)),
    getLatestUpdateFinalized: ContainerData(ssz.altair.LightClientUpdate),
    getLatestUpdateNonFinalized: ContainerData(ssz.altair.LightClientUpdate),
    // Just sent the proof JSON as-is
    getInitProof: sameType(),
  };
}
