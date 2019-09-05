import {IFastifyServer} from "../../index";
import {IApiModules} from "../../../interface";
import fastify from "fastify";

export const registerSyncingEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<fastify.DefaultQuery, {}, unknown>('/syncing', {}, async (request, reply) => {
    reply
      .code(200)
      .type('application/json')
      .send({
        "is_syncing": !await modules.sync.isSynced(),
        "sync_status": {
          //TODO: unstub
          "starting_slot": 0,
          "current_slot": 0,
          "highest_slot": 0
        }
      });
  });
};