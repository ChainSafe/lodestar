import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";

export const getBlockHeader: ApiController<DefaultQuery, {blockId: string}> = {
  url: "/headers/:blockId",
  method: "GET",

  handler: async function (req) {
    const data = await this.api.beacon.blocks.getBlockHeader(req.params.blockId);
    return {
      data: this.config.types.phase0.SignedBeaconHeaderResponse.toJson(data, {case: "snake"}),
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
