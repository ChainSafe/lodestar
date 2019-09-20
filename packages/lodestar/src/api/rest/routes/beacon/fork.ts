import {IFastifyServer} from "../../index";
import * as fastify from "fastify";
import {IApiModules} from "../../../interface";
import {getFork} from "../../../impl/beacon/fork";

export const registerForkEndpoint = (server: IFastifyServer, modules: IApiModules): void => {
  server.get<fastify.DefaultQuery, {}, unknown>("/fork", {}, async (request, reply) => {
    reply.code(200).type("application/json").send(await getFork(modules.db, modules.chain));
  });
};