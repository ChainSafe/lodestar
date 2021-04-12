import {ApiController} from "../types";
import {DefaultQuery} from "fastify";

export const getWtfNode: ApiController<DefaultQuery> = {
  url: "/wtfnode/",
  method: "GET",

  handler: async function () {
    return this.api.lodestar.getWtfNode();
  },
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController<DefaultQuery> = {
  url: "/ws_epoch/",
  method: "GET",

  handler: async function () {
    return this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch;
  },
};
