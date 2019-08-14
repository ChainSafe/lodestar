import {IFastifyServer} from "../../index";
import * as fastify from "fastify";
import {IApiModules} from "../../../interface";

export const registerVersionEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<fastify.DefaultQuery, {}, unknown>('/version', {}, (request, reply) => {
    reply.code(200).type('application/json').send("Lodestar x.x.x");
  });
};