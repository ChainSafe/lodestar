import {FastifyInstance} from "fastify";
import {getHeads} from "../../controllers/debug/beacon/getHeads";

/**
 * Register /debug route
 */
export function registerDebugRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      // beacon
      fastify.get(getHeads.url, getHeads.opts, getHeads.handler);
    },
    {prefix: "/v1/debug"}
  );
}
