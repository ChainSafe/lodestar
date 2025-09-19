import {ChainForkConfig} from "@lodestar/config";
import type {FastifyInstance} from "fastify";
import {AnyEndpoint} from "../../utils/codecs.js";
import {ApplicationMethods, FastifyRoute, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, getDefinitions} from "../routes.js";

export type BuilderApiMethods = ApplicationMethods<Endpoints>;

export function getRoutes(config: ChainForkConfig, methods: BuilderApiMethods): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(getDefinitions(config), methods);
}

export function registerRoutes(server: FastifyInstance, config: ChainForkConfig, methods: BuilderApiMethods): void {
  const routes = getRoutes(config, methods);

  for (const route of Object.values(routes)) {
    server.route(route as FastifyRoute<AnyEndpoint>);
  }
}
