import {SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {DefaultParams, DefaultQuery} from "fastify";
import {notNullish} from "../../../../util/notNullish";
import {ApiController} from "../types";

type Body = Json[];

export const publishAggregateAndProof: ApiController<DefaultQuery, DefaultParams, Body> = {
  url: "/aggregate_and_proofs",

  handler: async function (req, resp) {
    await this.api.validator.publishAggregateAndProofs(
      req.body
        .map((aggreagteJson) => {
          try {
            return this.config.types.SignedAggregateAndProof.fromJson(aggreagteJson, {case: "snake"});
          } catch (e) {
            this.log.warn("Failed to parse AggregateAndProof", e.message);
            return null;
          }
        })
        .filter(notNullish) as SignedAggregateAndProof[]
    );
    resp.status(200).send();
  },

  opts: {
    schema: {
      body: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
        },
      },
    },
  },
};
