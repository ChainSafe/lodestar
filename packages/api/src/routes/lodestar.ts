import {Epoch} from "@chainsafe/lodestar-types";
import {jsonType, ReqEmpty, reqEmpty, ReturnTypes, ReqSerializers, RoutesData, sameType, Schema} from "../utils";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type SyncChainDebugState = {
  targetRoot: string | null;
  targetSlot: number | null;
  syncType: string;
  status: string;
  startEpoch: number;
  peers: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batches: any[];
};

export type Api = {
  /** TODO: description */
  getWtfNode(): Promise<{data: string}>;
  /** Trigger to write a heapdump to disk at `dirpath`. May take > 1min */
  writeHeapdump(dirpath?: string): Promise<{data: {filepath: string}}>;
  /** TODO: description */
  getLatestWeakSubjectivityCheckpointEpoch(): Promise<{data: Epoch}>;
  /** TODO: description */
  getSyncChainsDebugState(): Promise<{data: SyncChainDebugState[]}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getWtfNode: {url: "/eth/v1/lodestar/wtfnode/", method: "GET"},
  writeHeapdump: {url: "/eth/v1/lodestar/writeheapdump/", method: "GET"},
  getLatestWeakSubjectivityCheckpointEpoch: {url: "/eth/v1/lodestar/ws_epoch/", method: "GET"},
  getSyncChainsDebugState: {url: "/eth/v1/lodestar/sync-chains-debug-state", method: "GET"},
};

export type ReqTypes = {
  getWtfNode: ReqEmpty;
  writeHeapdump: {query: {dirpath?: string}};
  getLatestWeakSubjectivityCheckpointEpoch: ReqEmpty;
  getSyncChainsDebugState: ReqEmpty;
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getWtfNode: reqEmpty,
    writeHeapdump: {
      writeReq: (dirpath) => ({query: {dirpath}}),
      parseReq: ({query}) => [query.dirpath],
      schema: {query: {dirpath: Schema.String}},
    },
    getLatestWeakSubjectivityCheckpointEpoch: reqEmpty,
    getSyncChainsDebugState: reqEmpty,
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getWtfNode: sameType(),
    writeHeapdump: sameType(),
    getLatestWeakSubjectivityCheckpointEpoch: sameType(),
    getSyncChainsDebugState: jsonType(),
  };
}
