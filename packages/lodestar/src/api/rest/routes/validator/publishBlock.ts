import {IFastifyServer} from "../../index";
import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {fromRestJson} from "../../utils";

interface Body extends DefaultBody {
  beacon_block: object;
}


//TODO: add validation
const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, DefaultQuery, DefaultParams, DefaultHeaders, Body> = {
  schema: {
    body: {
      type: 'object',
      requiredKeys: ["beacon_block"],
      "beacon_block": {
        type: 'object'
      }
    }
  }
};

export const registerBlockPublishEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, Body>(
    '/block',
    opts,
    async (request, reply) => {
      await modules.chain.receiveBlock(
        fromRestJson(
          request.body.beacon_block, modules.config.types.BeaconBlock
        )
      );
      reply
        .code(200)
        .type('application/json')
        .send();
    }
  );
};