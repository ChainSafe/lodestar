import {ApiController} from "../types";

export const getSyncingStatus: ApiController = {
  url: "/v1/node/syncing",
  opts: {
    schema: {

    }
  },
  handler: async function(req, resp) {
    const status = await this.api.node.getSyncingStatus();

    resp.status(200).send({
      data: this.config.types.SyncingStatus.toJson(status, {case: "snake"})
    });
  }
};
