import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

type Query = {
  slot: number;
  committee_index: number;
};

export const produceAttestationData: ApiController<Query> = {
  url: "/eth/v1/validator/attestation_data",
  method: "GET",
  id: "produceAttestationData",

  handler: async function (req) {
    const attestationData = await this.api.validator.produceAttestationData(req.query.committee_index, req.query.slot);
    return {
      data: this.config.types.phase0.AttestationData.toJson(attestationData, {case: "snake"}),
    };
  },

  schema: {
    querystring: {
      type: "object",
      required: ["committee_index", "slot"],
      properties: {
        slot: {
          type: "number",
          minimum: 0,
        },
        committee_index: {
          type: "number",
          minimum: 0,
        },
      },
    },
  },
};
