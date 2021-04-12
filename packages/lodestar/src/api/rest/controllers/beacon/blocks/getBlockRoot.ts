import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {toRestValidationError} from "../../utils";

export const getBlockRoot: ApiController<DefaultQuery, {blockId: string}> = {
  url: "/blocks/:blockId/root",
  method: "GET",

  handler: async function (req, resp) {
    try {
      const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
      if (!data) {
        return resp.status(404).send();
      }
      return {
        data: {
          root: this.config.types.Root.toJson(this.config.types.phase0.BeaconBlock.hashTreeRoot(data.message)),
        },
      };
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
