import {ApiController} from "../../types";

export const getBlockRoot: ApiController<null, {blockId: string}> = {
  url: "/blocks/:blockId/root",
  method: "GET",
  id: "getBlockRoot",

  handler: async function (req) {
    const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
    return {
      data: {
        root: this.config.types.Root.toJson(this.config.types.phase0.BeaconBlock.hashTreeRoot(data.message)),
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
