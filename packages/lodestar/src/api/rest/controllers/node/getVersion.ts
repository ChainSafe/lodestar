import {ApiController} from "../types";

export const getVersion: ApiController = {
  url: "/v1/node/version",
  opts: {
    schema: {

    }
  },
  handler: async function(req, resp) {
    const version = await this.api.node.getVersion();

    resp.status(200).send({
      data: {
        version
      }
    });
  }
};
