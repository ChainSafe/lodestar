import {IFastifyServer} from "../../index";
import * as fastify from "fastify";
import {IApiModules} from "../../../interface";

export const registerGenesisTimeEndpoint = (server: IFastifyServer, modules: IApiModules): void => {
  server.get<fastify.DefaultQuery, {}, unknown>("/genesis_time", {}, (request, reply) => {
    reply.code(200).type("application/json").send(modules.chain.latestState.genesisTime);
  });
};