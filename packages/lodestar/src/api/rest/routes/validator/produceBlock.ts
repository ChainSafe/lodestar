import {IFastifyServer} from "../../index";
import fastify, {DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {assembleBlock} from "../../../../chain/factory/block";
import {toRestJson} from "../../utils";

interface Query extends DefaultQuery {
  slot: number;
  randao_reveal: string;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, Query> = {
  schema: {
    querystring: {
      type: 'object',
      required: ["slot", "randao_reveal"],
      properties: {
        slot: {
          type: "integer",
          minimum: 0
        },
        "randao_reveal": {
          type: "string"
        }
      }
    },
  }
};

export const registerBlockProductionEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<Query>(
    '/block',
    opts,
    async (request, reply) => {
      const block = await assembleBlock(
        modules.config,
        modules.db,
        modules.opPool,
        modules.eth1,
        request.query.slot,
        Buffer.from(request.query.randao_reveal)
      );
      reply
        .code(200)
        .type('application/json')
        .send(toRestJson(block));
    }
  );
};