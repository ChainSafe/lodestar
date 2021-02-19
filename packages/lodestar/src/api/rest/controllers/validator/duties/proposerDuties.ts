import {DefaultQuery} from "fastify";
import {ApiController} from "../../types";

type Params = {
  epoch: number;
};

export const proposerDutiesController: ApiController<DefaultQuery, Params> = {
  url: "/duties/proposer/:epoch",

  handler: async function (req, resp) {
    const duties = await this.api.validator.getProposerDuties(req.params.epoch);
    resp
      .code(200)
      .type("application/json")
      .send({
        data: duties.map((d) => {
          return this.config.types.phase0.ProposerDuty.toJson(d, {case: "snake"});
        }),
      });
  },

  opts: {
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
  },
};
