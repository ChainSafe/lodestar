import fastify, {DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {LodestarRestApiEndpoint} from "../../interface";

interface IQuery extends DefaultQuery {
  epoch: number;
  committeeIndex: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery> = {
  schema: {
    querystring: {
      type: "object",
      required: ["epoch", "committeeIndex"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        },
        committeeIndex: {
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
        request.query.committeeIndex
      );
      reply
        .code(200)
        .type("application/json")
        .send(responseValue.map(value => config.types.Attestation.toJson(value, {case: "snake"})));
    }
  );
};
