import type {FastifyInstance} from "fastify";
import {ChainForkConfig} from "@lodestar/config";
import {ApplicationMethods, FastifyRoute, FastifyRoutes, createFastifyRoutes} from "../../utils/server.js";
import {Endpoints, getDefinitions} from "../routes.js";
import {AnyEndpoint} from "../../utils/codecs.js";

export function getRoutes(config: ChainForkConfig, methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(getDefinitions(config), methods);
}

export function registerRoutes(
  server: FastifyInstance,
  config: ChainForkConfig,
  methods: ApplicationMethods<Endpoints>
): void {
  const routes = getRoutes(config, methods);

  for (const route of Object.values(routes)) {
    server.route(route as FastifyRoute<AnyEndpoint>);
  }
}
