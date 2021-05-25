import {Epoch} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {jsonType, ReqEmpty, reqEmpty, ReturnTypes, RouteReqSerdes, RoutesData, sameType} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

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
  getLatestWeakSubjectivityCheckpointEpoch: {url: "/eth/v1/lodestar/ws_epoch/", method: "GET"},
  getSyncChainsDebugState: {url: "/eth/v1/lodestar/sync-chains-debug-state", method: "GET"},
};

export type ReqTypes = {[K in keyof Api]: ReqEmpty};

export function getReqSerdes(): RouteReqSerdes<Api, ReqTypes> {
  return mapValues(routesData, () => reqEmpty);
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    getWtfNode: sameType(),
    getLatestWeakSubjectivityCheckpointEpoch: sameType(),
    getSyncChainsDebugState: jsonType(),
  };
}
