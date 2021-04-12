import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";

export const getBlockAttestations: ApiController<DefaultQuery, {blockId: string}> = {
  url: "/blocks/:blockId/attestations",
  method: "GET",

  handler: async function (req) {
    const data = await this.api.beacon.blocks.getBlock(req.params.blockId);
    return {
      data: Array.from(data.message.body.attestations).map((attestations) => {
        this.config.types.phase0.Attestation.toJson(attestations, {case: "snake"});
      }),
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
