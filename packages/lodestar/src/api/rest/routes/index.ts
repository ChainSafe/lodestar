import {Api} from "@chainsafe/lodestar-api/lib/interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {FastifyInstance} from "fastify";
import {ApiControllerGeneric, ApiNamespace, RouteConfig} from "../types";
import * as beacon from "./beacon";
import * as configApi from "./config";
import * as debug from "./debug";
import * as events from "./events";
import * as lightclient from "./lightclient";
import * as lodestar from "./lodestar";
import * as node from "./node";
import * as validator from "./validator";

export function registerRoutes(
  fastify: FastifyInstance,
  config: IBeaconConfig,
  api: Api,
  enabledNamespaces: ApiNamespace[]
): void {
  const routesByNamespace: {
    // Enforces that we are declaring routes for every routeId in `Api`
    [K in keyof Api]: {
      [K2 in keyof Api[K]]: ApiControllerGeneric;
    };
  } = {
    // Initializes route types and their definitions
    beacon: beacon.getRoutes(config, api.beacon),
    config: configApi.getRoutes(config, api.config),
    debug: debug.getRoutes(config, api.debug),
    events: events.getRoutes(config, api.events),
    lightclient: lightclient.getRoutes(config, api.lightclient),
    lodestar: lodestar.getRoutes(api.lodestar),
    node: node.getRoutes(config, api.node),
    validator: validator.getRoutes(config, api.validator),
  };

  for (const namespace of enabledNamespaces) {
    const routes = routesByNamespace[namespace];
    if (!routes) {
      throw Error(`Unknown api namespace ${namespace}`);
    }

    for (const route of Object.values(routes)) {
      fastify.route({
        url: route.url,
        method: route.method,
        handler: route.handler,
        schema: route.schema,
        config: {operationId: route.id} as RouteConfig,
      });
    }
  }
}
