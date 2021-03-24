import {FastifyInstance} from "fastify";
import {getWtfNode, getSyncChainsDebugState} from "../controllers/lodestar";

/**
 * Register /lodestar route
 */
export function registerLodestarRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getWtfNode.url, getWtfNode.opts, getWtfNode.handler);
      fastify.get(getSyncChainsDebugState.url, getSyncChainsDebugState.opts, getSyncChainsDebugState.handler);
    },
    {prefix: "/v1/lodestar"}
  );
}
