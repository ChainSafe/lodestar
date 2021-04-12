import {FastifyInstance} from "fastify";
import {ApiController} from "../controllers/types";

export function registerRoutesToServer(
  server: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes: ApiController<any, any>[],
  prefix: string
): void {
  server.register(
    async function (fastify) {
      for (const route of routes) {
        fastify.route({
          url: route.url,
          method: route.method,
          handler: route.handler,
          ...route.opts,
        });
      }
    },
    {prefix}
  );
}
