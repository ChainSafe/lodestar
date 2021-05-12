import {ApiController} from "../../types";

export const getBlockAttestations: ApiController<null, {blockId: string}> = {
  url: "/eth/v1/beacon/blocks/:blockId/attestations",
  method: "GET",
  id: "getBlockAttestations",

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
