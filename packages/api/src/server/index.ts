import {IChainForkConfig} from "@chainsafe/lodestar-config";
// eslint-disable-next-line import/no-extraneous-dependencies
import {FastifyInstance} from "fastify";
import {Api} from "../interface";
import {ServerRoute} from "./utils";

import * as beacon from "./beacon";
import * as configApi from "./config";
import * as debug from "./debug";
import * as events from "./events";
import * as lightclient from "./lightclient";
import * as lodestar from "./lodestar";
import * as node from "./node";
import * as validator from "./validator";

export type RouteConfig = {
  operationId: ServerRoute["id"];
};

export function registerRoutes(
  server: FastifyInstance,
  config: IChainForkConfig,
  api: Api,
  enabledNamespaces: (keyof Api)[]
): void {
  const routesByNamespace: {
    // Enforces that we are declaring routes for every routeId in `Api`
    [K in keyof Api]: () => {
      // The ReqTypes are enforced in each getRoutes return type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [K2 in keyof Api[K]]: ServerRoute<any>;
    };
  } = {
    // Initializes route types and their definitions
    beacon: () => beacon.getRoutes(config, api.beacon),
    config: () => configApi.getRoutes(config, api.config),
    debug: () => debug.getRoutes(config, api.debug),
    events: () => events.getRoutes(config, api.events),
    lightclient: () => lightclient.getRoutes(config, api.lightclient),
    lodestar: () => lodestar.getRoutes(config, api.lodestar),
    node: () => node.getRoutes(config, api.node),
    validator: () => validator.getRoutes(config, api.validator),
  };

  for (const namespace of enabledNamespaces) {
    const routes = routesByNamespace[namespace];
    if (routes === undefined) {
      throw Error(`Unknown api namespace ${namespace}`);
    }

    registerRoutesGroup(server, routes());
  }
}

export function registerRoutesGroup(
  fastify: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routes: Record<string, ServerRoute<any>>
): void {
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
