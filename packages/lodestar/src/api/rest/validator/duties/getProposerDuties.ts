import {ApiController} from "../../types";

export const getProposerDuties: ApiController<null, {epoch: number}> = {
  url: "/eth/v1/validator/duties/proposer/:epoch",
  method: "GET",
  id: "getProposerDuties",

  handler: async function (req) {
    const value = await this.api.validator.getProposerDuties(req.params.epoch);
    return this.config.types.phase0.ProposerDutiesApi.toJson(value, {case: "snake"});
  },

  schema: {
    params: {
      type: "object",
      required: ["epoch"],
      properties: {
        epoch: {
          type: "number",
          minimum: 0,
        },
      },
    },
  },
};
