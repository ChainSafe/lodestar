import {Api, ServerApi} from "@lodestar/api";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {NodeIsSyncing} from "../impl/errors.js";
import {RestApiServer, RestApiServerModules, RestApiServerMetrics, RestApiServerOpts} from "./base.js";
export {allNamespaces} from "@lodestar/api";

export type BeaconRestApiServerOpts = Omit<RestApiServerOpts, "bearerToken"> & {
  enabled: boolean;
  api: (keyof Api)[];
};

export const beaconRestApiServerOpts: BeaconRestApiServerOpts = {
  enabled: true,
  // ApiNamespace "debug" is not turned on by default
  api: ["beacon", "config", "events", "node", "validator", "lightclient"],
  address: "127.0.0.1",
  port: 9596,
  cors: "*",
  // beacon -> validator API is trusted, and for large amounts of keys the payload is multi-MB
  bodyLimit: 10 * 1024 * 1024, // 10MB
};

export type BeaconRestApiServerModules = RestApiServerModules & {
  config: ChainForkConfig;
  logger: Logger;
  api: {[K in keyof Api]: ServerApi<Api[K]>};
  metrics: RestApiServerMetrics | null;
};

/**
 * REST API powered by `fastify` server.
 */
export class BeaconRestApiServer extends RestApiServer {
  constructor(optsArg: Partial<BeaconRestApiServerOpts>, modules: BeaconRestApiServerModules) {
    const opts = {...beaconRestApiServerOpts, ...optsArg};

    super(opts, modules);

    // Instantiate and register the routes with matching namespace in `opts.api`
    registerRoutes(this.server, modules.config, modules.api, opts.api);
  }

  protected shouldIgnoreError(err: Error): boolean {
    // Don't log ErrorAborted errors, they happen on node shutdown and are not usefull
    // Don't log NodeISSyncing errors, they happen very frequently while syncing and the validator polls duties
    return err instanceof ErrorAborted || err instanceof NodeIsSyncing;
  }
}
