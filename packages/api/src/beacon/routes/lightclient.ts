import {JsonPath} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {altair, phase0, ssz, SyncPeriod} from "@lodestar/types";
import {ArrayOf, ReturnTypes, RoutesData, Schema, sameType, ContainerData, ReqSerializers} from "../../utils/index.js";
import {queryParseProofPathsArr, querySerializeProofPathsArr} from "../../utils/serdes.js";

export type StateFormat = "json" | "ssz";
export const mimeTypeSSZ = "application/octet-stream";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type LightClientBootstrap = {
  header: phase0.BeaconBlockHeader;
  currentSyncCommittee: altair.SyncCommittee;
  /** Single branch proof from state root to currentSyncCommittee */
  currentSyncCommitteeBranch: Uint8Array[];
};

export type Api = {
  /**
   * Returns a multiproof of `jsonPaths` at the requested `stateId`.
   * The requested `stateId` may not be available. Regular nodes only keep recent states in memory.
   */
  getStateProof(stateId: string, jsonPaths: JsonPath[]): Promise<{data: Proof}>;
  /**
   * Returns an array of best updates given a `startPeriod` and `count` number of sync committee period to return.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getUpdates(startPeriod: SyncPeriod, count: number, format?: "json"): Promise<{data: altair.LightClientUpdate[]}>;
  getUpdates(startPeriod: SyncPeriod, count: number, format?: "ssz"): Promise<Uint8Array>;
  getUpdates(
    startPeriod: SyncPeriod,
    count: number,
    format?: StateFormat
  ): Promise<Uint8Array | {data: altair.LightClientUpdate[]}>;
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
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getStateProof: {url: "/eth/v1/beacon/light_client/proof/{state_id}", method: "GET"},
  getUpdates: {url: "/eth/v1/beacon/light_client/updates", method: "GET"},
  getOptimisticUpdate: {url: "/eth/v1/beacon/light_client/optimistic_update", method: "GET"},
  getFinalityUpdate: {url: "/eth/v1/beacon/light_client/finality_update", method: "GET"},
  getBootstrap: {url: "/eth/v1/beacon/light_client/bootstrap/{block_root}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getStateProof: {params: {state_id: string}; query: {paths: string[]}};
  getUpdates: {query: {start_period: number; count: number}; headers: {accept?: string}};
  getOptimisticUpdate: {headers: {accept?: string}};
  getFinalityUpdate: {headers: {accept?: string}};
  getBootstrap: {params: {block_root: string}; headers: {accept?: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (state_id, paths) => ({params: {state_id}, query: {paths: querySerializeProofPathsArr(paths)}}),
      parseReq: ({params, query}) => [params.state_id, queryParseProofPathsArr(query.paths)],
      schema: {params: {state_id: Schema.StringRequired}, body: Schema.AnyArray},
    },

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
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
    getUpdates: ContainerData(ArrayOf(ssz.altair.LightClientUpdate)),
    getOptimisticUpdate: ContainerData(ssz.altair.LightClientOptimisticUpdate),
    getFinalityUpdate: ContainerData(ssz.altair.LightClientFinalityUpdate),
    getBootstrap: ContainerData(ssz.altair.LightClientBootstrap),
  };
}
