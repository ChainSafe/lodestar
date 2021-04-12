import {ApiController} from "../types";

export const getVersion: ApiController = {
  url: "/version",
  method: "GET",

  handler: async function () {
    return {
      data: {
        version: await this.api.node.getVersion(),
      },
    };
  },
};
