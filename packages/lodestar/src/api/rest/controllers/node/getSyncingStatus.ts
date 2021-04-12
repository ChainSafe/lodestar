import {ApiController} from "../types";

export const getSyncingStatus: ApiController = {
  url: "/syncing",
  method: "GET",
  opts: {
    schema: {},
  },
  handler: async function (req, resp) {
    const status = await this.api.node.getSyncingStatus();

    resp.status(200).send({
      data: this.config.types.phase0.SyncingStatus.toJson(status, {case: "snake"}),
    });
  },
};
