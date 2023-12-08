import {ssz, SyncPeriod, allForks} from "@lodestar/types";
import {ForkName, isForkLightClient} from "@lodestar/params";
import {
  ArrayOf,
  ReturnTypes,
  RoutesData,
  Schema,
  ReqSerializers,
  reqEmpty,
  ReqEmpty,
  WithVersion,
  ContainerData,
} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  /**
   * Returns an array of best updates given a `startPeriod` and `count` number of sync committee period to return.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getLightClientUpdatesByRange(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {
        version: ForkName;
        data: allForks.LightClientUpdate;
      }[];
    }>
  >;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getLightClientOptimisticUpdate(): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {
        version: ForkName;
        data: allForks.LightClientOptimisticUpdate;
      };
    }>
  >;
  getLightClientFinalityUpdate(): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {
        version: ForkName;
        data: allForks.LightClientFinalityUpdate;
      };
    }>
  >;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getLightClientBootstrap(blockRoot: string): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {
        version: ForkName;
        data: allForks.LightClientBootstrap;
      };
    }>
  >;
  /**
   * Returns an array of sync committee hashes based on the provided period and count
   */
  getLightClientCommitteeRoot(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {
        data: Uint8Array[];
      };
    }>
  >;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getLightClientUpdatesByRange: {url: "/eth/v1/beacon/light_client/updates", method: "GET"},
  getLightClientOptimisticUpdate: {url: "/eth/v1/beacon/light_client/optimistic_update", method: "GET"},
  getLightClientFinalityUpdate: {url: "/eth/v1/beacon/light_client/finality_update", method: "GET"},
  getLightClientBootstrap: {url: "/eth/v1/beacon/light_client/bootstrap/{block_root}", method: "GET"},
  getLightClientCommitteeRoot: {url: "/eth/v0/beacon/light_client/committee_root", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getLightClientUpdatesByRange: {query: {start_period: number; count: number}};
  getLightClientOptimisticUpdate: ReqEmpty;
  getLightClientFinalityUpdate: ReqEmpty;
  getLightClientBootstrap: {params: {block_root: string}};
  getLightClientCommitteeRoot: {query: {start_period: number; count: number}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getLightClientUpdatesByRange: {
      writeReq: (start_period, count) => ({query: {start_period, count}}),
      parseReq: ({query}) => [query.start_period, query.count],
      schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
    },

    getLightClientOptimisticUpdate: reqEmpty,
    getLightClientFinalityUpdate: reqEmpty,

    getLightClientBootstrap: {
      writeReq: (block_root) => ({params: {block_root}}),
      parseReq: ({params}) => [params.block_root],
      schema: {params: {block_root: Schema.StringRequired}},
    },
    getLightClientCommitteeRoot: {
      writeReq: (start_period, count) => ({query: {start_period, count}}),
      parseReq: ({query}) => [query.start_period, query.count],
      schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  // Form a TypeJson convertor for getUpdates
  const VersionedUpdate = WithVersion((fork: ForkName) =>
    isForkLightClient(fork) ? ssz.allForksLightClient[fork].LightClientUpdate : ssz.altair.LightClientUpdate
  );
  const getLightClientUpdatesByRange = {
    toJson: (updates: {version: ForkName; data: allForks.LightClientUpdate}[]) =>
      updates.map((data) => VersionedUpdate.toJson(data)),
    fromJson: (updates: unknown[]) => updates.map((data) => VersionedUpdate.fromJson(data)),
  };

  return {
    getLightClientUpdatesByRange,
    getLightClientOptimisticUpdate: WithVersion((fork: ForkName) =>
      isForkLightClient(fork)
        ? ssz.allForksLightClient[fork].LightClientOptimisticUpdate
        : ssz.altair.LightClientOptimisticUpdate
    ),
    getLightClientFinalityUpdate: WithVersion((fork: ForkName) =>
      isForkLightClient(fork)
        ? ssz.allForksLightClient[fork].LightClientFinalityUpdate
        : ssz.altair.LightClientFinalityUpdate
    ),
    getLightClientBootstrap: WithVersion((fork: ForkName) =>
      isForkLightClient(fork) ? ssz.allForksLightClient[fork].LightClientBootstrap : ssz.altair.LightClientBootstrap
    ),
    getLightClientCommitteeRoot: ContainerData(ArrayOf(ssz.Root)),
  };
}
