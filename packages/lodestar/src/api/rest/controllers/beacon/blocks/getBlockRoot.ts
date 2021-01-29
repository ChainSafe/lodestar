import {DefaultQuery, FastifyError} from "fastify";
import {getBeaconBlockSSZType} from "@chainsafe/lodestar-utils";
import {ApiController} from "../../types";

export const getBlockRoot: ApiController<DefaultQuery, {blockId: string}> = {
  url: "/blocks/:blockId/root",

  handler: async function (req, resp) {
    try {
      const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
      if (!data) {
        return resp.status(404).send();
      }
      return resp.status(200).send({
        data: {
          root: this.config.types.Root.toJson(
            getBeaconBlockSSZType(this.config, data.message).hashTreeRoot(data.message)
          ),
        },
      });
    } catch (e) {
      if (e.message === "Invalid block id") {
        //TODO: fix when unifying errors
        throw {
          statusCode: 400,
          validation: [
            {
              dataPath: "block_id",
              message: e.message,
            },
          ],
        } as FastifyError;
      }
      throw e;
    }
  },

  opts: {
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
  },
};
