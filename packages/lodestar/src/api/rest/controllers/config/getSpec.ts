import {ApiController} from "../types";

export const getSpec: ApiController = {
  url: "/spec",

  handler: async function (req, resp) {
    const spec = this.api.config.getSpec();
    return resp.status(200).send({
      data: spec,
    });
  },

  opts: {
    schema: {},
  },
};
