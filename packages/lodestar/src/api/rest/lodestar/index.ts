import {ApiController} from "../types";

export const getWtfNode: ApiController = {
  url: "/wtfnode/",
  method: "GET",

  handler: async function () {
    return this.api.lodestar.getWtfNode();
  },
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController = {
  url: "/ws_epoch/",
  method: "GET",

  handler: async function () {
    return this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch();
  },
};

export const lodestarRoutes = [getWtfNode, getLatestWeakSubjectivityCheckpointEpoch];
