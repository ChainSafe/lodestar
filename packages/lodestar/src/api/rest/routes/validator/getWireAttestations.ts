import fastify, {DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {LodestarRestApiEndpoint} from "../../interface";

interface IQuery extends DefaultQuery {
  epoch: number;
  // eslint-disable-next-line camelcase
  committee_index: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["epoch", "committee_index"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        },
        "committee_index": {
          type: "integer",
          minimum: 0
        }
      }
    },
  }
};

export const registerGetWireAttestationEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<IQuery>(
    "/wire_attestations",
    opts,
    async (request, reply) => {
      const responseValue = await api.validator.getWireAttestations(
        request.query.epoch,
        request.query.committee_index
      );
      reply
        .code(200)
        .type("application/json")
        .send(responseValue.map(value => config.types.Attestation.toJson(value, {case: "snake"})));
    }
  );
};
