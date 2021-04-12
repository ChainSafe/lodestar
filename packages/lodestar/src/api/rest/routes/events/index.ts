//new
import {FastifyInstance} from "fastify";
import {registerRoutesToServer} from "../util";
import {getEventStream} from "../../controllers/events";

export function registerEventsRoutes(server: FastifyInstance): void {
  const routes = [getEventStream];
  registerRoutesToServer(server, routes, "/v1/events");
}
