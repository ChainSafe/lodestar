import {ContainerType, Path, VectorType} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {altair, phase0, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {ArrayOf, ReturnTypes, RoutesData, Schema, sameType, ContainerData, ReqSerializers} from "../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type LightclientSnapshotWithProof = {
  header: phase0.BeaconBlockHeader;
  currentSyncCommittee: altair.SyncCommittee;
  // TODO: Not really necessary since it can be fetched with an update
  nextSyncCommittee: altair.SyncCommittee;
  /** Single branch proof from state root to currentSyncCommittee parent */
  syncCommitteesBranch: Uint8Array[];
};

export type Api = {
  /**
   * Returns a multiproof of `paths` at the requested `stateId`.
   * The requested `stateId` may not be available. Regular nodes only keep recent states in memory.
   */
  getStateProof(stateId: string, paths: Path[]): Promise<{data: Proof}>;
  /**
   * Returns an array of best updates in the requested periods within the inclusive range `from` - `to`.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getCommitteeUpdates(from: SyncPeriod, to: SyncPeriod): Promise<{data: altair.LightClientUpdate[]}>;
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
  getStateProof: {url: "/eth/v1/lightclient/proof/:stateId", method: "POST"},
  getCommitteeUpdates: {url: "/eth/v1/lightclient/committee_updates", method: "GET"},
  getSnapshot: {url: "/eth/v1/lightclient/snapshot/:blockRoot", method: "GET"},
};

export type ReqTypes = {
  getStateProof: {params: {stateId: string}; body: Path[]};
  getCommitteeUpdates: {query: {from: number; to: number}};
  getSnapshot: {params: {blockRoot: string}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getStateProof: {
      writeReq: (stateId, paths) => ({params: {stateId}, body: paths}),
      parseReq: ({params, body}) => [params.stateId, body],
      schema: {params: {stateId: Schema.StringRequired}, body: Schema.AnyArray},
    },

    getCommitteeUpdates: {
      writeReq: (from, to) => ({query: {from, to}}),
      parseReq: ({query}) => [query.from, query.to],
      schema: {query: {from: Schema.UintRequired, to: Schema.UintRequired}},
    },

    getSnapshot: {
      writeReq: (blockRoot) => ({params: {blockRoot}}),
      parseReq: ({params}) => [params.blockRoot],
      schema: {params: {blockRoot: Schema.StringRequired}},
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const lightclientSnapshotWithProofType = new ContainerType<LightclientSnapshotWithProof>({
    fields: {
      header: ssz.phase0.BeaconBlockHeader,
      currentSyncCommittee: ssz.altair.SyncCommittee,
      nextSyncCommittee: ssz.altair.SyncCommittee,
      syncCommitteesBranch: new VectorType({elementType: ssz.Root, length: 4}),
    },
    // Custom type, not in the consensus specs
    casingMap: {
      header: "header",
      currentSyncCommittee: "current_sync_committee",
      nextSyncCommittee: "next_sync_committee",
      syncCommitteesBranch: "sync_committees_branch",
    },
  });

  return {
    // Just sent the proof JSON as-is
    getStateProof: sameType(),
    getCommitteeUpdates: ContainerData(ArrayOf(ssz.altair.LightClientUpdate)),
    getSnapshot: ContainerData(lightclientSnapshotWithProofType),
  };
}
