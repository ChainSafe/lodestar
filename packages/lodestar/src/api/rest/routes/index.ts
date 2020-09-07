import {FastifyInstance} from "fastify";

import {ApiNamespace} from "../../impl";
import {registerBeaconRoutes} from "./beacon";
import {registerNodeRoutes} from "./node";

export * from "./beacon";
export * from "./validator";

export function registerRoutes(server: FastifyInstance, enabledNamespaces: ApiNamespace[]): void {
  if (enabledNamespaces.includes(ApiNamespace.BEACON)) {
    registerBeaconRoutes(server);
  }
  if (enabledNamespaces.includes(ApiNamespace.NODE)) {
    registerNodeRoutes(server);
  }
}
