import {Json} from "@chainsafe/ssz";
import {DefaultParams, DefaultQuery} from "fastify";
import {ApiController} from "../types";

export const publishAggregateAndProof: ApiController<DefaultQuery, DefaultParams, Json[]> = {
  url: "/aggregate_and_proofs",
  method: "POST",

  handler: async function (req) {
    const signedAggregateAndProofs = req.body.map((item) =>
      this.config.types.phase0.SignedAggregateAndProof.fromJson(item, {case: "snake"})
    );

    await this.api.validator.publishAggregateAndProofs(signedAggregateAndProofs);
    return {};
  },

  schema: {
    body: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
      },
    },
  },
};
