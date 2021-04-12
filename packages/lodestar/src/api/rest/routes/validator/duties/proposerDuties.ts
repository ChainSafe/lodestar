import {DefaultQuery} from "fastify";
import {ApiController} from "../../types";

type Params = {
  epoch: number;
};

export const proposerDutiesController: ApiController<DefaultQuery, Params> = {
  url: "/duties/proposer/:epoch",
  method: "GET",

  handler: async function (req) {
    const duties = await this.api.validator.getProposerDuties(req.params.epoch);
    return {
      data: duties.map((d) => this.config.types.phase0.ProposerDuty.toJson(d, {case: "snake"})),
    };
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
