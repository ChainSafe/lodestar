import type {FastifyInstance} from "fastify";
import {ChainForkConfig} from "@lodestar/config";
import {ApplicationMethods, FastifyRouteConfig, FastifyRoutes, createFastifyRoutes} from "../../utils/server.js";
import {Endpoints, definitions} from "../routes.js";

// Re-export for convenience
export type {FastifyRouteConfig};

export function getRoutes(_config: ChainForkConfig, methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(definitions, methods);
}

export function registerRoutes(
  server: FastifyInstance,
  config: ChainForkConfig,
  methods: ApplicationMethods<Endpoints>
): void {
  const routes = getRoutes(config, methods);

  for (const route of Object.values(routes)) {
    server.route(route);
  }
}
