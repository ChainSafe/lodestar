import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {FastifyError} from "fastify";

export const getBlockAttestations: ApiController<DefaultQuery, {blockId: string}> = {

  url: "/v1/beacon/blocks/:blockId/attestations",

  handler: async function (req, resp) {
    try {
      const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
      if(!data) {
        return resp.status(404).send();
      }
      return resp.status(200)
        .send({
          data: Array.from(data.message.body.attestations).map(attestations => {
            this.config.types.Attestation.toJson(attestations, {case: "snake"});
          })
        });
    } catch (e) {
      if(e.message === "Invalid block id") {
        //TODO: fix when unifying errors
        throw {
          statusCode: 400,
          validation: [
            {
              dataPath: "block_id",
              message: e.message
            }
          ]
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
            types: "string"
          }
        }
      }
    }
  }
};
