import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {getValidatorDuties} from "../../../impl/validator";
import {IncomingMessage, Server, ServerResponse} from "http";
import {toRestJson} from "../../utils";

interface Query extends DefaultQuery {
  validator_pubkeys: string[];
  epoch: number;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query> = {
  schema: {
    querystring: {
      type: 'object',
      required: ["validator_pubkeys", "epoch"],
      properties: {
        "validator_pubkeys": {
          type: 'array',
          maxItems: 5,
          items: {
            types: "string"
          }
        },
        epoch: {
          type: "integer",
          minimum: 0
        }
      }
    },
  }
};

export const registerDutiesEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<Query>(
    '/duties',
    opts,
    async (request, reply) => {
      const duties = (await getValidatorDuties(
        modules.config,
        modules.db,
        request.query.validator_pubkeys.map(key => Buffer.from(key, 'hex')),
        request.query.epoch
      )).map(toRestJson);
      reply
        .code(200)
        .type('application/json')
        .send(duties);
    }
  );
};