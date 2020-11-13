import {DefaultQuery} from "fastify";
import {ApiController} from "../../types";

type Params = {
  epoch: number;
};

//validator indices
type Body = number[];

export const attesterDutiesController: ApiController<DefaultQuery, Params, Body> = {
  url: "/duties/attester/:epoch",

  handler: async function (req, resp) {
    const responseValue = await this.api.validator.getAttesterDuties(req.params.epoch, req.body);
    resp
      .code(200)
      .type("application/json")
      .send({
        data: responseValue.map((value) => {
          return this.config.types.AttesterDuty.toJson(value, {case: "snake"});
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
      body: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "number",
          minimum: 0,
        },
      },
    },
  },
};
