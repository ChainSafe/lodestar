import {ContainerType, JsonPath, VectorCompositeType} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {altair, phase0, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
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
} from "../utils/index.js";
import {queryParseProofPathsArr, querySerializeProofPathsArr} from "../utils/serdes.js";
import {LightclientHeaderUpdate} from "./events.js";

// Re-export for convenience when importing routes.lightclient.LightclientHeaderUpdate
export {LightclientHeaderUpdate};

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
   * Returns an array of best updates in the requested periods within the inclusive range `from` - `to`.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getCommitteeUpdates(from: SyncPeriod, to: SyncPeriod): Promise<{data: altair.LightClientUpdate[]}>;
  /**
   * Returns the latest best head update available. Clients should use the SSE type `lightclient_header_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getHeadUpdate(): Promise<{data: LightclientHeaderUpdate}>;
  /**
   * Fetch a snapshot with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getSnapshot(blockRoot: string): Promise<{data: LightclientSnapshotWithProof}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getStateProof: {url: "/eth/v1/lightclient/proof/:stateId", method: "GET"},
  getCommitteeUpdates: {url: "/eth/v1/lightclient/committee_updates", method: "GET"},
  getHeadUpdate: {url: "/eth/v1/lightclient/head_update/", method: "GET"},
  getSnapshot: {url: "/eth/v1/lightclient/snapshot/:blockRoot", method: "GET"},
};

export type ReqTypes = {
  getStateProof: {params: {stateId: string}; query: {paths: string[]}};
  getCommitteeUpdates: {query: {from: number; to: number}};
  getHeadUpdate: ReqEmpty;
  getSnapshot: {params: {blockRoot: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (stateId, paths) => ({params: {stateId}, query: {paths: querySerializeProofPathsArr(paths)}}),
      parseReq: ({params, query}) => [params.stateId, queryParseProofPathsArr(query.paths)],
      schema: {params: {stateId: Schema.StringRequired}, body: Schema.AnyArray},
    },

    getCommitteeUpdates: {
      writeReq: (from, to) => ({query: {from, to}}),
      parseReq: ({query}) => [query.from, query.to],
      schema: {query: {from: Schema.UintRequired, to: Schema.UintRequired}},
    },

    getHeadUpdate: reqEmpty,

    getSnapshot: {
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

  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
    getCommitteeUpdates: ContainerData(ArrayOf(ssz.altair.LightClientUpdate)),
    getHeadUpdate: ContainerData(lightclientHeaderUpdate),
    getSnapshot: ContainerData(lightclientSnapshotWithProofType),
  };
}
