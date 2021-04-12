import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {toRestValidationError} from "../../utils";

export const getBlock: ApiController<DefaultQuery, {blockId: string}> = {
  url: "/blocks/:blockId",
  method: "GET",

  handler: async function (req, resp) {
    try {
      const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
      if (!data) {
        return resp.status(404).send();
      }
      return resp.status(200).send({
        data: this.config.types.phase0.SignedBeaconBlock.toJson(data, {case: "snake"}),
      });
    } catch (e) {
      if ((e as Error).message === "Invalid block id") {
        throw toRestValidationError("block_id", (e as Error).message);
      }
      throw e;
    }
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
