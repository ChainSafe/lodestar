import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {ApiController} from "../../types";

// Body = validator indices
export const attesterDutiesController: ApiController<null, {epoch: number}, ValidatorIndex[]> = {
  url: "/duties/attester/:epoch",
  method: "POST",

  handler: async function (req) {
    const responseValue = await this.api.validator.getAttesterDuties(req.params.epoch, req.body);
    return {
      data: responseValue.map((value) => this.config.types.phase0.AttesterDuty.toJson(value, {case: "snake"})),
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
};
