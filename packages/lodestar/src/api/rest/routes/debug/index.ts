import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "../util";
import {getHeads} from "../../controllers/debug/beacon/getHeads";
import {getState} from "../../controllers/debug/beacon/getStates";

/**
 * Register /debug route
 */
export function registerDebugRoutes(server: FastifyInstance): void {
  const routes = [getHeads, getState];
  registerRoutesToServer(server, routes, "/v1/debug");
}
