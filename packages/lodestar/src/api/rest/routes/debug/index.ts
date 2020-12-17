import {FastifyInstance} from "fastify";
import {getHeads} from "../../controllers/debug/beacon/getHeads";
import {getState} from "../../controllers/debug/beacon/getStates";

/**
 * Register /debug route
 */
export function registerDebugRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      // beacon
      fastify.get(getHeads.url, getHeads.opts, getHeads.handler);
      fastify.get(getState.url, getState.opts, getState.handler);
    },
    {prefix: "/v1/debug"}
  );
}
