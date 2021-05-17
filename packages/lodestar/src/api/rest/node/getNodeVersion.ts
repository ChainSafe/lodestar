import {ApiController} from "../types";

export const getNodeVersion: ApiController = {
  url: "/eth/v1/node/version",
  method: "GET",
  id: "getNodeVersion",

  handler: async function () {
    return {
      data: {
        version: await this.api.node.getVersion(),
      },
    };
  },
};
