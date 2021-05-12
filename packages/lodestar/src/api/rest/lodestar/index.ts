import {ApiController} from "../types";

export const getWtfNode: ApiController = {
  url: "/eth/v1/lodestar/wtfnode/",
  method: "GET",
  id: "getWtfNode",

  handler: async function () {
    return this.api.lodestar.getWtfNode();
  },
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController = {
  url: "/eth/v1/lodestar/ws_epoch/",
  method: "GET",
  id: "getLatestWeakSubjectivityCheckpointEpoch",

  handler: async function () {
    return this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch();
  },
};

export const getSyncChainsDebugState: ApiController<{paths: (string | number)[][]}, {stateId: string}> = {
  url: "/eth/v1/lodestar/sync-chains-debug-state",
  method: "GET",
  id: "getSyncChainsDebugState",

  handler: async function () {
    return this.api.lodestar.getSyncChainsDebugState();
  },
};

export const lodestarRoutes = [getWtfNode, getLatestWeakSubjectivityCheckpointEpoch, getSyncChainsDebugState];
