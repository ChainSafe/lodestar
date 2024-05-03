import type {FastifyInstance} from "fastify";
import {ChainForkConfig} from "@lodestar/config";
import {ApplicationMethods, FastifyRoute, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, definitions} from "../routes.js";
import {AnyEndpoint} from "../../utils/codecs.js";

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
    server.route(route as FastifyRoute<AnyEndpoint>);
  }
}
