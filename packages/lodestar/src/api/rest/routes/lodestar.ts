import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "./util";
import {getWtfNode, getLatestWeakSubjectivityCheckpointEpoch} from "../controllers/lodestar";

/**
 * Register /lodestar route
 */
export function registerLodestarRoutes(server: FastifyInstance): void {
  const routes = [getWtfNode, getLatestWeakSubjectivityCheckpointEpoch];
  registerRoutesToServer(server, routes, "/v1/lodestar");
}
