import {FastifyServer} from "../../index";
import * as fastify from "fastify";

export const registerVersionEndpoint = (fastify: FastifyServer): void => {
  fastify.get<fastify.DefaultQuery, {}, unknown>('/version', {}, (request, reply) => {
    reply.code(200).send({});
  });
};