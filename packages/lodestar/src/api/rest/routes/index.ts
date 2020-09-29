import {FastifyInstance} from "fastify";

import {ApiNamespace} from "../../impl";
import {registerBeaconRoutes} from "./beacon";
import {registerNodeRoutes} from "./node";
import {registerEventsRoutes} from "./events";

export * from "./beacon";
export * from "./validator";

export function registerRoutes(server: FastifyInstance, enabledNamespaces: ApiNamespace[]): void {
  server.register(
    async function (fastify) {
      if (enabledNamespaces.includes(ApiNamespace.BEACON)) {
        registerBeaconRoutes(fastify);
      }
      if (enabledNamespaces.includes(ApiNamespace.NODE)) {
        registerNodeRoutes(fastify);
      }
      if (enabledNamespaces.includes(ApiNamespace.EVENTS)) {
        registerEventsRoutes(fastify);
      }
    },
    {prefix: "/eth"}
  );
}
