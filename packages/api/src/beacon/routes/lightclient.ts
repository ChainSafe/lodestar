import {altair, ssz, StringType, SyncPeriod} from "@lodestar/types";
import {ContainerType} from "@chainsafe/ssz";
import {ArrayOf, ReturnTypes, RoutesData, Schema, ContainerData, ReqSerializers} from "../../utils/index.js";

export type StateFormat = "json" | "ssz";
export const mimeTypeSSZ = "application/octet-stream";

export type RestLightClientUpdate = {
  version: string;
  data: altair.LightClientUpdate;
};

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes
export type Api = {
  /**
   * Returns an array of best updates given a `startPeriod` and `count` number of sync committee period to return.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getUpdates(startPeriod: SyncPeriod, count: number, format?: "json"): Promise<RestLightClientUpdate[]>;
  getUpdates(startPeriod: SyncPeriod, count: number, format?: "ssz"): Promise<Uint8Array>;
  getUpdates(
    startPeriod: SyncPeriod,
    count: number,
    format?: StateFormat
  ): Promise<Uint8Array | RestLightClientUpdate[]>;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getOptimisticUpdate(format?: "json"): Promise<{data: altair.LightClientOptimisticUpdate}>;
  getOptimisticUpdate(format?: "ssz"): Promise<Uint8Array>;
  getOptimisticUpdate(format?: StateFormat): Promise<Uint8Array | {data: altair.LightClientOptimisticUpdate}>;
  getFinalityUpdate(format?: "json"): Promise<{data: altair.LightClientFinalityUpdate}>;
  getFinalityUpdate(format?: "ssz"): Promise<Uint8Array>;
  getFinalityUpdate(format?: StateFormat): Promise<Uint8Array | {data: altair.LightClientFinalityUpdate}>;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getBootstrap(blockRoot: string, format?: "json"): Promise<{data: altair.LightClientBootstrap}>;
  getBootstrap(blockRoot: string, format?: "ssz"): Promise<Uint8Array>;
  getBootstrap(blockRoot: string, format?: StateFormat): Promise<Uint8Array | {data: altair.LightClientBootstrap}>;
  /**
   * Returns an array of sync committee hashes based on the provided period and count
   */
  getCommitteeRoot(startPeriod: SyncPeriod, count: number): Promise<{data: Uint8Array[]}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getUpdates: {url: "/eth/v1/beacon/light_client/updates", method: "GET"},
  getOptimisticUpdate: {url: "/eth/v1/beacon/light_client/optimistic_update", method: "GET"},
  getFinalityUpdate: {url: "/eth/v1/beacon/light_client/finality_update", method: "GET"},
  getBootstrap: {url: "/eth/v1/beacon/light_client/bootstrap/{block_root}", method: "GET"},
  getCommitteeRoot: {url: "/eth/v0/beacon/light_client/committee_root", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getUpdates: {query: {start_period: number; count: number}; headers: {accept?: string}};
  getOptimisticUpdate: {headers: {accept?: string}};
  getFinalityUpdate: {headers: {accept?: string}};
  getBootstrap: {params: {block_root: string}; headers: {accept?: string}};
  getCommitteeRoot: {query: {start_period: number; count: number}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getUpdates: {
      writeReq: (start_period, count, format) => ({
        query: {start_period, count},
        headers: {accept: format === "ssz" ? mimeTypeSSZ : ""},
      }),
      parseReq: ({query, headers}) => [
        query.start_period,
        query.count,
        headers.accept === mimeTypeSSZ ? "ssz" : "json",
      ],
      schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
    },

    getOptimisticUpdate: {
      writeReq: (format) => ({
        headers: {accept: format === "ssz" ? mimeTypeSSZ : ""},
      }),
      parseReq: ({headers}) => [headers.accept === mimeTypeSSZ ? "ssz" : "json"],
      schema: {},
    },

    getFinalityUpdate: {
      writeReq: (format) => ({
        headers: {accept: format === "ssz" ? mimeTypeSSZ : ""},
      }),
      parseReq: ({headers}) => [headers.accept === mimeTypeSSZ ? "ssz" : "json"],
      schema: {},
    },

    getBootstrap: {
      writeReq: (block_root, format) => ({
        params: {block_root},
        headers: {accept: format === "ssz" ? mimeTypeSSZ : ""},
      }),
      parseReq: ({params, headers}) => [params.block_root, headers.accept === mimeTypeSSZ ? "ssz" : "json"],
      schema: {params: {block_root: Schema.StringRequired}},
    },
    getCommitteeRoot: {
      writeReq: (start_period, count) => ({query: {start_period, count}}),
      parseReq: ({query}) => [query.start_period, query.count],
      schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const restLightClientUpdate = new ContainerType({
    version: new StringType(), // TODO DA change type
    data: ssz.altair.LightClientUpdate,
  });

  return {
    getUpdates: ArrayOf(restLightClientUpdate),
    getOptimisticUpdate: ContainerData(ssz.altair.LightClientOptimisticUpdate),
    getFinalityUpdate: ContainerData(ssz.altair.LightClientFinalityUpdate),
    getBootstrap: ContainerData(ssz.altair.LightClientBootstrap),
    getCommitteeRoot: ContainerData(ArrayOf(ssz.Root)),
  };
}
