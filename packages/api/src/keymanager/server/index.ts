import {IChainForkConfig} from "@lodestar/config";
import {ServerApi} from "../../interfaces.js";
import {
  ServerInstance,
  ServerRoutes,
  getGenericJsonServer,
  registerRoute,
  RouteConfig,
} from "../../utils/server/index.js";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes.js";

// Re-export for convenience
export {RouteConfig};

export function getRoutes(config: IChainForkConfig, api: ServerApi<Api>): ServerRoutes<Api, ReqTypes> {
  // All routes return JSON, use a server auto-generator
  return getGenericJsonServer<ServerApi<Api>, ReqTypes>({routesData, getReturnTypes, getReqSerializers}, config, api);
}

export function registerRoutes(server: ServerInstance, config: IChainForkConfig, api: ServerApi<Api>): void {
  const routes = getRoutes(config, api);

  for (const route of Object.values(routes)) {
    registerRoute(server, route);
  }
}
