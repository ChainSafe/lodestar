import {ChainForkConfig} from "@lodestar/config";
import {Api} from "../routes/index.js";
import {ServerInstance, ServerRoute, RouteConfig, registerRoute} from "../../utils/server/index.js";

import {ServerApi} from "../../interfaces.js";
import * as beacon from "./beacon.js";
import * as configApi from "./config.js";
import * as debug from "./debug.js";
import * as events from "./events.js";
import * as lightclient from "./lightclient.js";
import * as lodestar from "./lodestar.js";
import * as node from "./node.js";
import * as proof from "./proof.js";
import * as validator from "./validator.js";

// Re-export for convenience
export {RouteConfig};

export function registerRoutes(
  server: ServerInstance,
  config: ChainForkConfig,
  api: {[K in keyof Api]: ServerApi<Api[K]>},
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
    proof: () => proof.getRoutes(config, api.proof),
    validator: () => validator.getRoutes(config, api.validator),
  };

  for (const namespace of enabledNamespaces) {
    const routes = routesByNamespace[namespace];
    if (routes === undefined) {
      throw Error(`Unknown api namespace ${namespace}`);
    }

    for (const route of Object.values(routes())) {
      registerRoute(server, route);
    }
  }
}
