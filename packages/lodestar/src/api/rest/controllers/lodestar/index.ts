import {ApiController} from "../types";
import {DefaultQuery} from "fastify";

export const getWtfNode: ApiController<DefaultQuery> = {
  url: "/wtfnode/",
  method: "GET",
  handler: function (req, resp) {
    resp.status(200).send(this.api.lodestar.getWtfNode());
  },
  opts: {},
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController<DefaultQuery> = {
  url: "/ws_epoch/",
  method: "GET",
  handler: async function (req, resp) {
    return resp.status(200).send(this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch);
  },
  opts: {},
};
