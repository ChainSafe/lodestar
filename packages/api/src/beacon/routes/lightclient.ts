import {altair, ssz, StringType, SyncPeriod} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {ContainerType} from "@chainsafe/ssz";
import {
  ArrayOf,
  ReturnTypes,
  RoutesData,
  Schema,
  ReqSerializers,
  reqEmpty,
  ReqEmpty,
  WithVersion,
  APIClientResponse,
  ContainerData,
} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type LightClientBootstrap = {
  header: altair.LightClientHeader;
  currentSyncCommittee: altair.SyncCommittee;
  /** Single branch proof from state root to currentSyncCommittee */
  currentSyncCommitteeBranch: Uint8Array[];
};

export type Api<ErrorAsResponse extends boolean = false> = {
  /**
   * Returns an array of best updates given a `startPeriod` and `count` number of sync committee period to return.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    APIClientResponse<
      {
        [HttpStatusCode.OK]: {
          version: ForkName;
          data: altair.LightClientUpdate;
        }[];
      },
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      ErrorAsResponse
    >
  >;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getOptimisticUpdate(): Promise<
    APIClientResponse<
      {
        [HttpStatusCode.OK]: {
          version: ForkName;
          data: altair.LightClientOptimisticUpdate;
        };
      },
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      ErrorAsResponse
    >
  >;
  getFinalityUpdate(): Promise<
    APIClientResponse<
      {
        [HttpStatusCode.OK]: {
          version: ForkName;
          data: altair.LightClientFinalityUpdate;
        };
      },
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      ErrorAsResponse
    >
  >;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getBootstrap(
    blockRoot: string
  ): Promise<
    APIClientResponse<
      {
        [HttpStatusCode.OK]: {
          version: ForkName;
          data: altair.LightClientBootstrap;
        };
      },
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      ErrorAsResponse
    >
  >;
  /**
   * Returns an array of sync committee hashes based on the provided period and count
   */
  getCommitteeRoot(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    APIClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: Uint8Array[];
        };
      },
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      ErrorAsResponse
    >
  >;
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
    getUpdates: ArrayOf(
      new ContainerType({
        version: new StringType<ForkName>(),
        data: ssz.altair.LightClientUpdate,
      })
    ),
    getOptimisticUpdate: WithVersion(() => ssz.altair.LightClientOptimisticUpdate),
    getFinalityUpdate: WithVersion(() => ssz.altair.LightClientFinalityUpdate),
    getBootstrap: WithVersion(() => ssz.altair.LightClientBootstrap),
    getCommitteeRoot: ContainerData(ArrayOf(ssz.Root)),
  };
}
