import {ApiController} from "../../types";

export const getBlockRoot: ApiController<null, {blockId: string}> = {
  url: "/eth/v1/beacon/blocks/:blockId/root",
  method: "GET",
  id: "getBlockRoot",

  handler: async function (req) {
    const root = await this.api.beacon.blocks.getBlockRoot(req.params.blockId);
    return {
      data: {
        root: this.config.types.Root.toJson(root),
      },
    };
  },

  schema: {
    params: {
      type: "object",
      required: ["blockId"],
      properties: {
        blockId: {
          types: "string",
        },
      },
    },
  },
};
