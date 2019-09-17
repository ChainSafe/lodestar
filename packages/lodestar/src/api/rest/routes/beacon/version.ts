import {IFastifyServer} from "../../index";
import * as fastify from "fastify";

export const registerVersionEndpoint = (server: IFastifyServer): void => {
  server.get<fastify.DefaultQuery, {}, unknown>("/version", {}, (request, reply) => {
    reply.code(200).type("application/json").send(`lodestar-${process.env.npm_package_version}`);
  });
};