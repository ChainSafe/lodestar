import {IncomingMessage, Server, ServerResponse} from "http";
import {FastifyInstance, Middleware} from "fastify";

import {IApiModules} from "../../impl";

export const applySyncingMiddleware = (fastify: FastifyInstance, route: string, modules: IApiModules): void => {
  const syncingMiddleware: Middleware<Server, IncomingMessage, ServerResponse> = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: Function
  ): Promise<void> => {
    if (!(await modules.sync.isSynced())) {
      response.statusCode = 503;
      response.end("Beacon node is currently syncing, try again later.");
      return;
    }
    next();
  };

  fastify.use(route, syncingMiddleware);
};
