import fastify, {DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {LodestarRestApiEndpoint} from "../../interface";
import {fromHex} from "@chainsafe/lodestar-utils";

interface IQuery extends DefaultQuery {
  attestationData: string;
  aggregatorPubkey: string;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["attestationData", "aggregatorPubkey"],
      properties: {
        attestationData: {
          type: "string"
        },
        aggregatorPubkey: {
          type: "string"
        }
      }
    },
  }
};

export const registerAggregateAndProofProductionEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<IQuery>(
    "/aggregate_and_proof",
    opts,
    async (request, reply) => {
      const serialized = fromHex(request.query.attestationData);
      const aggregate = await api.validator.produceAggregateAndProof(
        config.types.AttestationData.deserialize(serialized),
        config.types.BLSPubkey.fromJson(request.query.aggregatorPubkey, {case: "snake"})
      );
      reply
        .code(200)
        .type("application/json")
        .send(config.types.AggregateAndProof.toJson(aggregate, {case: "snake"}));
    }
  );
};
