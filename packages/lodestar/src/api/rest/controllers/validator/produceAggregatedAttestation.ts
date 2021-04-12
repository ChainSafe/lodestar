import {ApiController} from "../types";
import {fromHex} from "@chainsafe/lodestar-utils";

type Query = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  attestation_data_root: string;
  slot: number;
};

export const produceAggregatedAttestation: ApiController<Query> = {
  url: "/aggregate_attestation",
  method: "GET",

  handler: async function (req, resp) {
    const aggregate = await this.api.validator.getAggregatedAttestation(
      fromHex(req.query.attestation_data_root),
      req.query.slot
    );
    resp.status(200).send({
      data: this.config.types.phase0.Attestation.toJson(aggregate, {case: "snake"}),
    });
  },

  opts: {
    schema: {
      querystring: {
        type: "object",
        required: ["attestation_data_root", "slot"],
        properties: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          attestation_data_root: {
            type: "string",
          },
          slot: {
            type: "number",
            minimum: 0,
          },
        },
      },
    },
  },
};
