import type {FastifyInstance} from "fastify";
import {ChainForkConfig} from "@lodestar/config";
import {ServerError} from "../../utils/error.js";
import {ApplicationMethods, FastifyRoute, FastifyRouteConfig} from "../../utils/server.js";
import {Endpoints} from "../routes/index.js";

import * as beacon from "./beacon.js";
import * as configApi from "./config.js";
import * as debug from "./debug.js";
import * as events from "./events.js";
import * as lightclient from "./lightclient.js";
import * as lodestar from "./lodestar.js";
import * as node from "./node.js";
import * as proof from "./proof.js";
import * as validator from "./validator.js";

// Re-export for usage in beacon-node
export {ServerError as ApiError};

// Re-export for convenience
export type {FastifyRouteConfig};

export function registerRoutes(
  server: FastifyInstance,
  config: ChainForkConfig,
  methods: {[K in keyof Endpoints]: ApplicationMethods<Endpoints[K]>},
  enabledNamespaces: (keyof Endpoints)[]
): void {
  const routesByNamespace: {
    // Enforces that we are declaring routes for every routeId in `Endpoints`
    [K in keyof Endpoints]: () => {
      // The Endpoints are enforced in each getRoutes return type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [K2 in keyof Endpoints[K]]: FastifyRoute<any>;
    };
  } = {
    // Initializes route types and their definitions
    beacon: () => beacon.getRoutes(config, methods.beacon),
    config: () => configApi.getRoutes(methods.config),
    debug: () => debug.getRoutes(methods.debug),
    events: () => events.getRoutes(methods.events),
    lightclient: () => lightclient.getRoutes(config, methods.lightclient),
    lodestar: () => lodestar.getRoutes(methods.lodestar),
    node: () => node.getRoutes(methods.node),
    proof: () => proof.getRoutes(methods.proof),
    validator: () => validator.getRoutes(methods.validator),
  };

  for (const namespace of enabledNamespaces) {
    const routes = routesByNamespace[namespace];
    if (routes === undefined) {
      throw Error(`Unknown api namespace ${namespace}`);
    }

    for (const route of Object.values(routes())) {
      // Append the namespace as a tag for downstream consumption
      route.schema.tags = [namespace];
      server.route(route);
    }
  }
}
