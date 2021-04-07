import {FastifyInstance} from "fastify";
import {getWtfNode, getLatestWeakSubjectivityCheckpointEpoch} from "../controllers/lodestar";

/**
 * Register /lodestar route
 */
export function registerLodestarRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getWtfNode.url, getWtfNode.opts, getWtfNode.handler);
      fastify.get(
        getLatestWeakSubjectivityCheckpointEpoch.url,
        getLatestWeakSubjectivityCheckpointEpoch.opts,
        getLatestWeakSubjectivityCheckpointEpoch.handler
      );
    },
    {prefix: "/v1/lodestar"}
  );
}
