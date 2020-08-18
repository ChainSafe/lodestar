import {IncomingMessage, Server, ServerResponse} from "http";
import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {LodestarRestApiEndpoint} from "../../../interface";

interface IParams extends DefaultParams {
  epoch: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, DefaultQuery, IParams> = {
  schema: {
    params: {
      type: "object",
      required: ["epoch"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        }
      }
    },
  }
};

export const registerProposerDutiesEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<DefaultQuery, IParams>(
    "/duties/:epoch/proposer",
    opts,
    async (request, reply) => {
      const responseValue = await api.validator.getProposerDuties(request.params.epoch);
      const response = responseValue.map(duty => config.types.ProposerDuty.toJson(duty, {case: "snake"}));
      reply
        .code(200)
        .type("application/json")
        .send(response);
    }
  );
};
