import {ChainForkConfig} from "@lodestar/config";
import type {FastifyInstance} from "fastify";
import {AnyEndpoint} from "../../utils/codecs.js";
import {ApplicationMethods, FastifyRoute, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, getDefinitions} from "../routes.js";

export type KeymanagerApiMethods = ApplicationMethods<Endpoints>;

export function getRoutes(config: ChainForkConfig, methods: KeymanagerApiMethods): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(getDefinitions(config), methods);
}

export function registerRoutes(server: FastifyInstance, config: ChainForkConfig, methods: KeymanagerApiMethods): void {
  const routes = getRoutes(config, methods);

  for (const route of Object.values(routes)) {
    server.route(route as FastifyRoute<AnyEndpoint>);
  }
}
