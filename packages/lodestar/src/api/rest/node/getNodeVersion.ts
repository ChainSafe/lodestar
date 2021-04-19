import {ApiController} from "../types";

export const getNodeVersion: ApiController = {
  url: "/version",
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
