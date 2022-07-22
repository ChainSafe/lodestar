import {ContainerType, JsonPath, VectorCompositeType} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {FINALIZED_ROOT_DEPTH} from "@lodestar/params";
import {altair, phase0, ssz, SyncPeriod} from "@lodestar/types";
import {
  ArrayOf,
  ReturnTypes,
  RoutesData,
  Schema,
  sameType,
  ContainerData,
  ReqSerializers,
  reqEmpty,
  ReqEmpty,
} from "../../utils/index.js";
import {queryParseProofPathsArr, querySerializeProofPathsArr} from "../../utils/serdes.js";
import {LightclientOptimisticHeaderUpdate, LightclientFinalizedUpdate} from "./events.js";

// Re-export for convenience when importing routes.lightclient.LightclientOptimisticHeaderUpdate
export {LightclientOptimisticHeaderUpdate, LightclientFinalizedUpdate};

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type LightclientSnapshotWithProof = {
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
  getUpdates(startPeriod: SyncPeriod, count: number): Promise<{data: altair.LightClientUpdate[]}>;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getOptimisticUpdate(): Promise<{data: LightclientOptimisticHeaderUpdate}>;
  getFinalityUpdate(): Promise<{data: LightclientFinalizedUpdate}>;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getBootstrap(blockRoot: string): Promise<{data: LightclientSnapshotWithProof}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getStateProof: {url: "/eth/v1/light_client/proof/:stateId", method: "GET"},
  getUpdates: {url: "/eth/v1/light_client/updates", method: "GET"},
  getOptimisticUpdate: {url: "/eth/v1/light_client/optimistic_update/", method: "GET"},
  getFinalityUpdate: {url: "/eth/v1/light_client/finality_update/", method: "GET"},
  getBootstrap: {url: "/eth/v1/light_client/bootstrap/:blockRoot", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getStateProof: {params: {stateId: string}; query: {paths: string[]}};
  getUpdates: {query: {start_period: number; count: number}};
  getOptimisticUpdate: ReqEmpty;
  getFinalityUpdate: ReqEmpty;
  getBootstrap: {params: {blockRoot: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (stateId, paths) => ({params: {stateId}, query: {paths: querySerializeProofPathsArr(paths)}}),
      parseReq: ({params, query}) => [params.stateId, queryParseProofPathsArr(query.paths)],
      schema: {params: {stateId: Schema.StringRequired}, body: Schema.AnyArray},
    },

    getUpdates: {
      writeReq: (start_period, count) => ({query: {start_period, count}}),
      parseReq: ({query}) => [query.start_period, query.count],
      schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
    },

    getOptimisticUpdate: reqEmpty,
    getFinalityUpdate: reqEmpty,

    getBootstrap: {
      writeReq: (blockRoot) => ({params: {blockRoot}}),
      parseReq: ({params}) => [params.blockRoot],
      schema: {params: {blockRoot: Schema.StringRequired}},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const lightclientSnapshotWithProofType = new ContainerType(
    {
      header: ssz.phase0.BeaconBlockHeader,
      currentSyncCommittee: ssz.altair.SyncCommittee,
      currentSyncCommitteeBranch: new VectorCompositeType(ssz.Root, 5),
    },
    {jsonCase: "eth2"}
  );

  const lightclientHeaderUpdate = new ContainerType(
    {
      syncAggregate: ssz.altair.SyncAggregate,
      attestedHeader: ssz.phase0.BeaconBlockHeader,
    },
    {jsonCase: "eth2"}
  );

  const lightclientFinalizedUpdate = new ContainerType(
    {
      attestedHeader: ssz.phase0.BeaconBlockHeader,
      finalizedHeader: ssz.phase0.BeaconBlockHeader,
      finalityBranch: new VectorCompositeType(ssz.Bytes32, FINALIZED_ROOT_DEPTH),
      syncAggregate: ssz.altair.SyncAggregate,
    },
    {jsonCase: "eth2"}
  );

  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
    getUpdates: ContainerData(ArrayOf(ssz.altair.LightClientUpdate)),
    getOptimisticUpdate: ContainerData(lightclientHeaderUpdate),
    getFinalityUpdate: ContainerData(lightclientFinalizedUpdate),
    getBootstrap: ContainerData(lightclientSnapshotWithProofType),
  };
}
