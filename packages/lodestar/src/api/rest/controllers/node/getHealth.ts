import {ApiController} from "../types";

export const getHealth: ApiController = {
  url: "/v1/node/health",
  opts: {
    schema: {

    }
  },
  handler: async function(req, resp) {
    const status = await this.api.node.getNodeStatus();
    switch (status) {
      case "ready": return resp.status(200).send();
      case "syncing": return resp.status(206).send();
      default: return resp.status(503).send();
    }
  }
};
