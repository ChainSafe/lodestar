import {ApiController} from "../types";
import {DefaultQuery} from "fastify";

export const getWtfNode: ApiController<DefaultQuery> = {
  url: "/wtfnode/",
  handler: function (req, resp) {
    resp.status(200).send(this.api.lodestar.getWtfNode());
  },
  opts: {},
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController<DefaultQuery> = {
  url: "/wsEpoch/",
  handler: async function (req, resp) {
    const state = await this.api.beacon.state.getState("head");
    if (state === null) return resp.status(404).send("State not found");
    return resp.status(200).send(() => this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch(state));
  },
  opts: {},
};
