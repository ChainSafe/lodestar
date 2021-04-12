import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";

export const getBlock: ApiController<DefaultQuery, {blockId: string}> = {
  url: "/blocks/:blockId",
  method: "GET",

  handler: async function (req) {
    const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
    return {
      data: this.config.types.phase0.SignedBeaconBlock.toJson(data, {case: "snake"}),
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
