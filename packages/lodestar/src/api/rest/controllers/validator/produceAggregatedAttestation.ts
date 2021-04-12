import {ApiController} from "../types";
import {fromHex} from "@chainsafe/lodestar-utils";

/* eslint-disable @typescript-eslint/naming-convention */

type Query = {
  attestation_data_root: string;
  slot: number;
};

export const produceAggregatedAttestation: ApiController<Query> = {
  url: "/aggregate_attestation",
  method: "GET",

  handler: async function (req) {
    const aggregate = await this.api.validator.getAggregatedAttestation(
      fromHex(req.query.attestation_data_root),
      req.query.slot
    );
    return {
      data: this.config.types.phase0.Attestation.toJson(aggregate, {case: "snake"}),
    };
  },

  schema: {
    querystring: {
      type: "object",
      required: ["attestation_data_root", "slot"],
      properties: {
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
};
