import fastify, {DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {LodestarRestApiEndpoint} from "../../interface";
import {fromHex} from "@chainsafe/lodestar-utils";

interface IQuery extends DefaultQuery {
  // eslint-disable-next-line camelcase
  attestation_data: string;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["attestation_data"],
      properties: {
        "attestation_data": {
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
      const serialized = fromHex(request.query.attestation_data);
      const aggregatedAttestation = await api.validator.produceAggregatedAttestation(
        config.types.AttestationData.deserialize(serialized)
      );
      reply
        .code(200)
        .type("application/json")
        .send(config.types.Attestation.toJson(aggregatedAttestation));
    }
  );
};
