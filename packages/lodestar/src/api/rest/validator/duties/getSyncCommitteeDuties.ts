import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {ApiController} from "../../types";

export const getAttesterDuties: ApiController<null, {epoch: number}, ValidatorIndex[]> = {
  url: "/eth/v1/validator/duties/sync/:epoch",
  method: "POST",
  id: "getAttesterDuties",

  handler: async function (req) {
    const data = await this.api.validator.getSyncCommitteeDuties(req.params.epoch, req.body);
    return this.config.types.altair.SyncDutiesApi.toJson(data, {case: "snake"});
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
      items: {
        type: "number",
        minimum: 0,
      },
    },
  },
};
