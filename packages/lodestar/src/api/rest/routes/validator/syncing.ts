import { IFastifyServer } from "../..";
import { IApiModules } from "../../..";
import { IncomingMessage, ServerResponse } from 'http';


export const registerSyncingMiddleware = (fastify: IFastifyServer, modules: IApiModules): void => {
  const syncingMiddleware = (request: IncomingMessage, response: ServerResponse, next: Function) => {
    if (!modules.sync.isSynced()) {
      response.statusCode = 503;
      response.end("Beacon node is currently syncing, try again later.");
      return;
    }
    next();
  }

  fastify.use("/validator/*", syncingMiddleware);
};