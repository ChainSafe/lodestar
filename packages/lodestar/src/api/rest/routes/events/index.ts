//new
import {FastifyInstance} from "fastify";
import {getEventStream} from "../../controllers/events";

export function registerEventsRoutes(server: FastifyInstance): void {
  server.register(
    async function (fastify) {
      fastify.get(getEventStream.url, getEventStream.opts, getEventStream.handler);
    },
    {prefix: "/v1/events"}
  );
}
