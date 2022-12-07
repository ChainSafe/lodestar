import {altair, phase0, ssz, SyncPeriod} from "@lodestar/types";
import {
  ArrayOf,
  ReturnTypes,
  RoutesData,
  Schema,
  ContainerData,
  ReqSerializers,
  reqEmpty,
  ReqEmpty,
} from "../../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type LightClientBootstrap = {
  header: phase0.BeaconBlockHeader;
  currentSyncCommittee: altair.SyncCommittee;
  /** Single branch proof from state root to currentSyncCommittee */
  currentSyncCommitteeBranch: Uint8Array[];
};

export type Api = {
  /**
   * Returns an array of best updates given a `startPeriod` and `count` number of sync committee period to return.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getUpdates(startPeriod: SyncPeriod, count: number): Promise<{data: altair.LightClientUpdate[]}>;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getOptimisticUpdate(): Promise<{data: altair.LightClientOptimisticUpdate}>;
  getFinalityUpdate(): Promise<{data: altair.LightClientFinalityUpdate}>;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getBootstrap(blockRoot: string): Promise<{data: LightClientBootstrap}>;
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
  getUpdates: {query: {start_period: number; count: number}};
  getOptimisticUpdate: ReqEmpty;
  getFinalityUpdate: ReqEmpty;
  getBootstrap: {params: {block_root: string}};
  getCommitteeRoot: {query: {start_period: number; count: number}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getUpdates: {
      writeReq: (start_period, count) => ({query: {start_period, count}}),
      parseReq: ({query}) => [query.start_period, query.count],
      schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
    },

    getOptimisticUpdate: reqEmpty,
    getFinalityUpdate: reqEmpty,

    getBootstrap: {
      writeReq: (block_root) => ({params: {block_root}}),
      parseReq: ({params}) => [params.block_root],
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
  return {
    getUpdates: ContainerData(ArrayOf(ssz.altair.LightClientUpdate)),
    getOptimisticUpdate: ContainerData(ssz.altair.LightClientOptimisticUpdate),
    getFinalityUpdate: ContainerData(ssz.altair.LightClientFinalityUpdate),
    getBootstrap: ContainerData(ssz.altair.LightClientBootstrap),
    getCommitteeRoot: ContainerData(ArrayOf(ssz.Root)),
  };
}
