import {ApiController} from "../types";

type Query = {
  slot: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  committee_index: number;
};

export const produceAttestationData: ApiController<Query> = {
  url: "/attestation_data",

  handler: async function (req, resp) {
    const attestationData = await this.api.validator.produceAttestationData(req.query.committee_index, req.query.slot);
    resp.send({
      data: this.config.types.AttestationData.toJson(attestationData, {case: "snake"}),
    });
  },

  opts: {
    schema: {
      querystring: {
        type: "object",
        required: ["committee_index", "slot"],
        properties: {
          slot: {
            type: "number",
            minimum: 0,
          },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          committee_index: {
            type: "number",
            minimum: 0,
          },
        },
      },
    },
  },
};
