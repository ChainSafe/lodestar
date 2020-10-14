import {ApiController} from "../../types";

export const publishBlock: ApiController = {
  url: "/blocks",

  handler: async function (req, resp) {
    await this.api.validator.publishBlock(this.config.types.SignedBeaconBlock.fromJson(req.body, {case: "snake"}));
    resp.code(200).type("application/json").send();
  },

  opts: {
    schema: {
      body: {
        type: "object",
      },
    },
  },
};
